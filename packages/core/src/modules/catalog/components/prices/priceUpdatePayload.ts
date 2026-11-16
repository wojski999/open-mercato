import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import type { PriceFormValues } from './priceFormFields'

export function buildPriceUpdatePayload(
  id: string,
  values: PriceFormValues,
  t: (key: string, fallback?: string) => string,
): Record<string, unknown> {
  const productId = values.productId?.trim() || undefined
  const variantId = values.variantId?.trim() || undefined
  if (!productId && !variantId) {
    const message = t('catalog.prices.form.errors.productOrVariantRequired', 'Choose a product or a variant.')
    throw createCrudFormError(message, { productId: message })
  }
  return {
    id,
    productId,
    variantId,
    priceKindId: values.priceKindId?.trim() || undefined,
    currencyCode: values.currencyCode?.trim() || undefined,
    unitPriceNet: values.unitPriceNet?.trim() || undefined,
    unitPriceGross: values.unitPriceGross?.trim() || undefined,
    taxRate: values.taxRate?.trim() || undefined,
    minQuantity: values.minQuantity ?? undefined,
    maxQuantity: values.maxQuantity ?? null,
    startsAt: values.startsAt?.trim() || null,
    endsAt: values.endsAt?.trim() || null,
    customerId: values.customerId?.trim() || undefined,
    customerGroupId: values.customerGroupId?.trim() || undefined,
    channelId: values.channelId?.trim() || undefined,
    offerId: values.offerId?.trim() || undefined,
    userId: values.userId?.trim() || undefined,
    userGroupId: values.userGroupId?.trim() || undefined,
  }
}
