import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { addCustomLine, createSalesDocument } from '@open-mercato/core/modules/core/__integration__/helpers/salesUi';

/**
 * TC-SALES-002: Quote To Order Conversion
 * Source: .ai/qa/scenarios/TC-SALES-002-quote-to-order-conversion.md
 */
test.describe('TC-SALES-002: Quote To Order Conversion', () => {
  test('should convert quote into order from actions menu', async ({ page }) => {
    // Heavy multi-hop UI flow (login + createSalesDocument + line) routinely
    // exceeds Playwright's 20s default on a loaded ephemeral shard; opt into the
    // sanctioned per-test budget (see TC-SALES-005). Global bump is disallowed.
    test.slow();
    await login(page, 'admin');
    await createSalesDocument(page, { kind: 'quote', preferApi: true });
    await addCustomLine(page, {
      name: `QA TC-SALES-002 ${Date.now()}`,
      quantity: 1,
      unitPriceGross: 25,
    });

    const actionsButton = page.getByRole('button', { name: /^Actions$/i });
    await actionsButton.hover();
    await page.getByRole('menuitem', { name: /Convert to order/i }).click();

    await expect(page).toHaveURL(/\/backend\/sales\/(documents\/[0-9a-f-]{36}\?kind=order|orders\/[0-9a-f-]{36})$/i);
    await expect(page.getByText(/Sales order/i).first()).toBeVisible();
  });
});
