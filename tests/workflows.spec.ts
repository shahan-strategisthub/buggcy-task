import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function switchUser(page: Page, label: string) {
  await page.getByRole('combobox', { name: 'Switch demo user' }).click();
  await page.getByRole('option', { name: label, exact: true }).click();
}

test('the user switcher supports keyboard selection and remembers the active user', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const switcher = page.getByRole('combobox', { name: 'Switch demo user' });
  const menu = page.getByRole('listbox', { name: 'Demo users' });
  await expect(switcher).toContainText('Ava Chen');
  await switcher.press('Enter');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('option', { name: 'Ava Chen', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('option', { name: 'Daniel Park', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(switcher).toBeFocused();
  await expect(switcher).toContainText('Ava Chen');
  await switcher.press('Enter');
  await expect(menu.getByRole('option', { name: 'Ava Chen', exact: true })).toBeFocused();
  await page.keyboard.press('m');
  await expect(menu.getByRole('option', { name: 'Maya Patel', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(switcher).toContainText('Maya Patel');
  await page.reload();
  await expect(switcher).toContainText('Maya Patel');
});

test('create a task, bid in another session, receive a live update and complete the lifecycle', async ({ page, context }) => {
  const title = `Validate export permissions ${Date.now().toString().slice(-6)}`;
  await page.goto('/');
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New task' }).click();
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Description', { exact: true }).fill('Confirm workspace export access respects the selected user role.');
  await page.getByLabel('Deadline', { exact: true }).fill('2030-12-01T11:30');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByRole('dialog')).toContainText(title);
  await page.getByRole('button', { name: 'Open bidding' }).click();
  await expect(page.getByText('Moved to open.')).toBeVisible();
  const taskUrl = page.url();

  const bidder = await context.newPage();
  await bidder.goto('/');
  await switchUser(bidder, 'Daniel Park');
  await bidder.goto(taskUrl);
  const hours = bidder.getByLabel('Hours to complete');
  await hours.fill('999');
  await expect(bidder.getByRole('button', { name: 'Place bid' })).toBeDisabled();
  await hours.fill('2');
  await bidder.getByRole('button', { name: 'Place bid' }).click();
  await expect(bidder.getByText('Your bid was placed.')).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Daniel Park', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('2 h', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Close bidding' }).click();
  await page.getByRole('button', { name: 'Auto-assign' }).click();
  await expect(page.getByText('Assigned to Daniel Park.')).toBeVisible();
  await bidder.getByRole('button', { name: 'Start work' }).click();
  await bidder.getByRole('button', { name: 'Send to review' }).click();
  await page.getByRole('button', { name: 'Mark done' }).click();
  await expect(page.getByText('Moved to done.')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('region', { name: 'Done', exact: true }).getByRole('link', { name: new RegExp(title) })).toBeVisible();
});

test('a stale capacity display refreshes after the server rejects a bid', async ({ page, request }) => {
  const json = (id: number) => ({ 'X-User-Id': String(id) });
  const users = await (await request.get('/api/users')).json();
  const owner = users[0].id;
  const fixture = await (await request.post('/api/demo/scenarios/stale', { headers: json(owner) })).json();
  const target = await (await request.post('/api/tasks', { headers: json(owner), data: {
    title: 'Review remaining capacity', description: 'Confirm a bid reflects the latest available hours.',
    complexity: 2, deadline: '2030-12-01T11:30:00Z',
  } })).json();
  await request.patch(`/api/tasks/${target.id}/status`, { headers: json(owner), data: { status: 'open' } });
  await page.route('**/api/events', (route) => route.abort());
  await page.goto('/');
  await switchUser(page, fixture.bidder.name);
  await page.goto(`/#task/${target.id}`);
  await expect(page.getByText('15 h available. Enter a whole number within your capacity.')).toBeVisible();
  const reserved = await request.post(`/api/tasks/${fixture.taskIds[0]}/assign`, { headers: json(owner) });
  expect(reserved.status()).toBe(200);
  await page.getByLabel('Hours to complete').fill('3');
  await page.getByRole('button', { name: 'Place bid' }).click();
  await expect(page.getByRole('alert')).toContainText('Your remaining capacity changed');
  await expect(page.getByText('2 h available. Enter a whole number within your capacity.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Place bid' })).toBeDisabled();
  await page.getByLabel('Hours to complete').fill('2');
  await page.getByRole('button', { name: 'Place bid' }).click();
  await expect(page.getByText('Your bid was placed.')).toBeVisible();
});

test('dashboard, review lab, and mobile layout work through the workspace navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Task board' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Average bid by complexity' })).toBeVisible();
  await expect(page.locator('.recharts-bar-rectangle').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Review accessibility labels' })).toBeVisible();
  await page.getByRole('link', { name: 'Review lab' }).click();
  await page.getByRole('button', { name: 'Run capacity race' }).click();
  await expect(page.getByText('No bidder currently has enough capacity to take this task.')).toBeVisible();
  await expect(page.getByText('Assigned to Alex Morgan', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Run stale bid' }).click();
  await expect(page.getByText('Assigned to Taylor Kim', { exact: false })).toBeVisible();
  await expect(page.getByText(/has 2 h remaining/)).toBeVisible();
});
