import { Module } from '@nestjs/common';
import { ShopifyProvider } from './shopify.provider';
import { StripeProvider } from './stripe.provider';

/**
 * Isolated from ToolsModule so JobsModule can depend on the provider
 * implementations (RefundProcessor needs StripeProvider) without creating a
 * JobsModule <-> ToolsModule import cycle — ToolsModule also needs JobsModule
 * (to enqueue refund jobs), so the providers had to live one level lower.
 */
@Module({
  providers: [ShopifyProvider, StripeProvider],
  exports: [ShopifyProvider, StripeProvider],
})
export class ProvidersModule {}
