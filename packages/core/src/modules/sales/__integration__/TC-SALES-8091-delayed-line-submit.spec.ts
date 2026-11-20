import { expect, test } from '@playwright/test';
import { addCustomLine } from '@open-mercato/core/helpers/integration/salesUi';

test('TC-SALES-8091: submits a custom line once while the dialog waits for save', async ({ page }) => {
  const lineName = 'Delayed custom line';

  await page.setContent(`
    <button type="button">Items</button>
    <button type="button" id="open-line">Add item</button>
    <dialog aria-label="Add line">
      <button type="button" id="custom-line">Custom line</button>
      <form hidden>
        <label>Name <input name="lineName" /></label>
        <input aria-label="0.00" name="price" />
        <input aria-label="1" name="quantity" />
        <button type="submit">Add item</button>
      </form>
    </dialog>
    <output aria-label="Submit attempts">0</output>
    <table><tbody></tbody></table>
    <script>
      const dialog = document.querySelector('dialog');
      const form = dialog.querySelector('form');
      const attempts = document.querySelector('output');
      document.querySelector('#open-line').onclick = () => dialog.showModal();
      document.querySelector('#custom-line').onclick = () => { form.hidden = false; };
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        attempts.value = String(Number(attempts.value) + 1);
        if (attempts.value !== '1') return;

        const fields = new FormData(form);
        setTimeout(() => {
          const row = document.querySelector('tbody').insertRow();
          row.insertCell().textContent = fields.get('lineName');
          row.insertCell().textContent = fields.get('quantity');
          row.insertCell().textContent = fields.get('price');
          dialog.close();
        }, 6_000);
      });
    </script>
  `);

  await addCustomLine(page, { name: lineName, quantity: 2, unitPriceGross: 13 });

  expect(await page.getByRole('status', { name: 'Submit attempts' }).textContent()).toBe('1');
  await expect(page.getByRole('row', { name: 'Delayed custom line 2 13', exact: true })).toBeVisible();
});
