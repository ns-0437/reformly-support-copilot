import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { captureException } from '../../observability/sentry';

/**
 * Catches everything that escapes a controller/service. HttpExceptions
 * (validation errors, NotFoundException, etc.) are expected control flow and
 * are just passed through with their real status; anything else is an
 * unexpected failure — those are exactly the ones worth sending to Sentry
 * and returning as a generic 500 rather than leaking internals.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<{ method: string; url: string }>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const message = isHttpException ? exception.getResponse() : 'Internal server error';

    if (!isHttpException) {
      this.logger.error(`Unhandled exception on ${request.method} ${request.url}: ${(exception as Error)?.message}`);
      captureException(exception, { method: request.method, url: request.url });
    }

    response.status(status).json(
      typeof message === 'string' ? { statusCode: status, message } : { statusCode: status, ...message },
    );
  }
}
