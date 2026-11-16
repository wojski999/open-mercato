import { buildPriceUpdatePayload } from '../priceUpdatePayload'
import type { PriceFormValues } from '../priceFormFields'

const translate = (_key: string, fallback?: string) => fallback ?? _key
const priceId = '11111111-1111-4111-8111-111111111111'

function formValues(overrides: Partial<PriceFormValues> = {}): PriceFormValues {
  return {
    productId: '44444444-4444-4444-8444-444444444444',
    variantId: '',
    priceKindId: '55555555-5555-4555-8555-555555555555',
    currencyCode: 'USD',
    unitPriceNet: '77.0000',
    unitPriceGross: '77.0000',
    taxRate: '',
    minQuantity: 5,
    maxQuantity: 20,
    startsAt: '2026-11-01',
    endsAt: '2027-01-31',
    customerId: '',
    customerGroupId: '',
    channelId: '',
    offerId: '',
    userId: '',
    userGroupId: '',
    ...overrides,
  } as PriceFormValues
}

describe('buildPriceUpdatePayload', () => {
  it('sends null for bounds the user cleared so the update clears them', () => {
    const payload = buildPriceUpdatePayload(
      priceId,
      formValues({ maxQuantity: undefined, startsAt: '', endsAt: '  ' }),
      translate,
    )
    expect(payload).toMatchObject({ id: priceId, maxQuantity: null, startsAt: null, endsAt: null })
  })

  it('sends the filled bounds unchanged', () => {
    const payload = buildPriceUpdatePayload(priceId, formValues(), translate)
    expect(payload).toMatchObject({ minQuantity: 5, maxQuantity: 20, startsAt: '2026-11-01', endsAt: '2027-01-31' })
  })

  it('still requires a product or a variant', () => {
    expect(() => buildPriceUpdatePayload(priceId, formValues({ productId: '' }), translate)).toThrow()
  })
})
