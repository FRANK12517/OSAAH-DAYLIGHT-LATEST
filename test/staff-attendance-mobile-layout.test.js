import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const publicRoot = resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const statuses = [
  { status: 'PRESENT', type: 'PRESENT', label: 'Present' },
  { status: 'ABSENT', type: 'ABSENT', label: 'Absent' },
  { status: 'LATE', type: 'LATE', label: 'Late' },
  { status: 'CHECKED_IN', type: 'CHECKED_IN', label: 'Checked In' },
  { status: 'CHECKED_OUT', type: 'CHECKED_OUT', label: 'Checked Out' },
  { status: 'ON_LEAVE', type: 'ON_LEAVE', label: 'On Leave' },
  { status: 'EXCUSED', type: 'EXCUSED', label: 'Excused' }
];
const staff = Array.from({ length: 7 }, (_, index) => ({
  id: `test-staff-${String(index + 1).padStart(3, '0')}`,
  employeeId: `TEST-${String(index + 1).padStart(3, '0')}`,
  fullName: `Synthetic Test Staff ${String(index + 1).padStart(2, '0')}`,
  roleKey: index % 2 ? 'Assistant Teacher' : 'Teacher'
}));
const response = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function startStaticServer() {
  const server = createServer(async (request, result) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const allowed = new Map([
      ['/staff-attendance.html', ['staff-attendance.html', 'text/html; charset=utf-8']],
      ['/styles.css', ['styles.css', 'text/css; charset=utf-8']]
    ]);
    const entry = allowed.get(pathname);
    if (!entry) {
      result.writeHead(404).end('Not found');
      return;
    }
    try {
      result.writeHead(200, { 'content-type': entry[1], 'cache-control': 'no-store' });
      result.end(await readFile(resolve(publicRoot, entry[0])));
    } catch {
      result.writeHead(500).end('Unable to read test asset');
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}/staff-attendance.html` };
}

test('Staff Attendance mobile preservation safeguard renders, scrolls, orders and saves correctly', { timeout: 120_000 }, async (t) => {
  const { server, url } = await startStaticServer();
  t.after(() => new Promise((resolveClose) => server.close(resolveClose)));

  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
  t.after(() => browser.close());

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  let persistedRecords = [];
  const savedPayloads = [];
  await page.route('**/api/attendance/options', (route) => route.fulfill(response({
    academicYears: [{ id: 'test-year', name: '2026/2027' }],
    terms: [{ id: 'test-term', name: 'First Term', academicYearId: 'test-year' }]
  })));
  await page.route('**/api/attendance/staff**', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const payload = request.postDataJSON();
      savedPayloads.push(payload);
      const prior = persistedRecords.find((record) => record.staffId === payload.staffId);
      const record = {
        id: prior?.id ?? `record-${payload.staffId}`,
        staffId: payload.staffId,
        date: payload.date,
        academicYear: payload.academicYear,
        term: payload.term,
        type: payload.type,
        status: payload.status,
        time: payload.time,
        note: payload.note,
        source: 'MANUAL',
        recordedBy: 'Isolated browser fixture',
        updatedAt: '2026-10-10T09:00:00.000Z'
      };
      persistedRecords = [...persistedRecords.filter((item) => item.staffId !== record.staffId), record];
      await route.fulfill(response(record, prior ? 200 : 201));
      return;
    }
    await route.fulfill(response({ staff, records: persistedRecords, attendanceOptions: statuses }));
  });

  await page.goto(url);
  await page.selectOption('#attendance-academic-year', '2026/2027');
  await page.selectOption('#attendance-term', 'First Term');
  await page.getByRole('button', { name: 'Load Register' }).click({ force: true });
  await page.locator('tr[data-staff-id]').first().waitFor();

  const rows = page.locator('#staff-register tr[data-staff-id]');
  assert.equal(await rows.count(), 7, 'exactly one canonical editable row should exist per staff member');
  assert.deepEqual(await rows.evaluateAll((items) => items.map((item) => item.dataset.staffId)), staff.map((item) => item.id), 'staff order must follow the canonical API roster sequence');
  assert.equal(await page.locator('#staff-register select[data-status]').count(), 7, 'one status dropdown is rendered for each canonical staff row');

  const firstStaffName = staff[0].fullName;
  const firstStatus = page.getByLabel(`Attendance status for ${firstStaffName}`);
  assert.equal(await firstStatus.count(), 1, 'the attendance dropdown must have a staff-specific accessible name');
  assert.deepEqual(await firstStatus.locator('option').evaluateAll((items) => items.slice(1).map((item) => item.textContent.trim())), statuses.map((item) => item.label), 'the dropdown must expose exactly the seven required statuses in order');
  assert.equal(await page.getByLabel(`Reporting time for ${firstStaffName}`).count(), 1, 'reporting time must have an accessible staff-specific name');
  assert.equal(await page.getByLabel(`Reason or remarks for ${firstStaffName}`).count(), 1, 'remarks must have an accessible staff-specific name');

  await firstStatus.focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await firstStatus.inputValue(), 'PRESENT', 'keyboard users can move from the placeholder to the first status');
  await firstStatus.selectOption(statuses[0].status);
  await page.locator('input[data-time="test-staff-001"]').fill('08:15');
  await page.locator('input[data-note="test-staff-001"]').fill('Synthetic fixture note');
  for (let index = 1; index < staff.length; index += 1) {
    await rows.nth(index).locator('select[data-status]').selectOption(statuses[index].status);
  }
  assert.deepEqual(await page.locator('#staff-register select[data-status]').evaluateAll((items) => items.map((select) => select.value)), statuses.map((item) => item.status), 'each staff member has one selected status and keeps its own selection');
  assert.ok(await page.locator('#staff-register select[data-status]').evaluateAll((items) => items.every((select) => select.selectedOptions.length === 1)), 'status controls must be single-selection dropdowns');

  await page.getByRole('button', { name: 'Save attendance' }).click({ force: true });
  await page.getByText('Saved attendance for 7 staff members.').waitFor();
  assert.equal(savedPayloads.length, 7, 'the existing save workflow should submit one record per selected staff member');
  assert.deepEqual(Object.fromEntries(savedPayloads.map((item) => [item.staffId, item.status])), Object.fromEntries(staff.map((item, index) => [item.id, statuses[index].status])), 'status submissions must remain associated with the correct staff members');
  const firstSaved = savedPayloads.find((item) => item.staffId === staff[0].id);
  assert.equal(firstSaved.time, '08:15');
  assert.equal(firstSaved.note, 'Synthetic fixture note');
  assert.deepEqual(Object.fromEntries(persistedRecords.map((item) => [item.staffId, item.status])), Object.fromEntries(staff.map((item, index) => [item.id, statuses[index].status])), 'the isolated save endpoint must retain all seven staff/status associations');
  assert.equal(await page.locator('#attendance-report-rows tr.staff-report-row').count(), 7, 'the existing report remains available and renders saved records');

  await page.reload();
  await page.selectOption('#attendance-academic-year', '2026/2027');
  await page.selectOption('#attendance-term', 'First Term');
  await page.getByRole('button', { name: 'Load Register' }).click({ force: true });
  await page.locator('#staff-register tr[data-staff-id]').first().waitFor();
  assert.deepEqual(await page.locator('#staff-register select[data-status]').evaluateAll((items) => items.map((select) => select.value)), statuses.map((item) => item.status), 'saved choices must persist through a fresh page load');
  await page.getByLabel(`Attendance status for ${firstStaffName}`).focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-time')), staff[0].id, 'keyboard tab order proceeds from status to reporting time');

  const viewportSizes = [
    [320, 800], [360, 800], [375, 812], [390, 844], [430, 932],
    [768, 1024], [1024, 900], [1280, 900],
    [844, 390], [915, 412]
  ];
  for (const [width, height] of viewportSizes) {
    await page.setViewportSize({ width, height });
    const layout = await page.evaluate(() => {
      const root = document.documentElement;
      const main = document.querySelector('.staff-attendance-page');
      const firstRow = document.querySelector('#staff-register tr[data-staff-id]');
      const fields = [...firstRow.querySelectorAll(':scope > td')].map((cell) => {
        const label = cell.querySelector('.staff-mobile-label');
        const target = cell.querySelector('.staff-cell-value, select, input');
        if (!label || !target) return { label: label?.textContent.trim() ?? null, error: 'missing field label or value' };
        const labelBox = label.getBoundingClientRect();
        const targetBox = target.getBoundingClientRect();
        return {
          label: label.textContent.trim(),
          visible: getComputedStyle(label).display !== 'none' && labelBox.width > 0 && labelBox.height > 0,
          labelAboveValue: labelBox.bottom <= targetBox.top + 1,
          top: targetBox.top
        };
      });
      const xScrollers = [...main.querySelectorAll('*')].filter((element) => {
        const overflow = getComputedStyle(element).overflowX;
        return ['auto', 'scroll'].includes(overflow) && element.scrollWidth > element.clientWidth + 1;
      }).map((element) => ({ element: element.className?.baseVal ?? element.className ?? element.tagName.toLowerCase(), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, tables: [...element.querySelectorAll('table')].map((table) => ({ className: table.className, width: table.getBoundingClientRect().width, clientWidth: table.clientWidth, scrollWidth: table.scrollWidth, minWidth: getComputedStyle(table).minWidth, layout: getComputedStyle(table).tableLayout, cells: [...(table.querySelector('tbody tr')?.cells ?? [])].map((cell) => ({ text: cell.textContent.trim().slice(0, 40), width: cell.getBoundingClientRect().width, scrollWidth: cell.scrollWidth, wrap: getComputedStyle(cell).overflowWrap, whiteSpace: getComputedStyle(cell).whiteSpace })) })) }));
      const reportLabelVisible = [...document.querySelectorAll('#attendance-report-rows tr.staff-report-row .staff-mobile-label')].every((label) => getComputedStyle(label).display !== 'none' && label.getBoundingClientRect().width > 0);
      return {
        viewport: window.innerWidth,
        documentWidth: root.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        mainWidth: main.scrollWidth,
        mainClientWidth: main.clientWidth,
        xScrollers,
        rowDisplay: getComputedStyle(firstRow).display,
        fields,
        reportLabelVisible,
        firstReportRowDisplay: getComputedStyle(document.querySelector('#attendance-report-rows tr.staff-report-row')).display
      };
    });
    assert.ok(layout.documentWidth <= width + 1, `${width}x${height}: document must not overflow horizontally (${layout.documentWidth}px)`);
    assert.ok(layout.bodyWidth <= width + 1, `${width}x${height}: body must not overflow horizontally (${layout.bodyWidth}px)`);
    assert.ok(layout.mainWidth <= layout.mainClientWidth + 1, `${width}x${height}: attendance page must not overflow horizontally`);
    assert.deepEqual(layout.xScrollers, [], `${width}x${height}: attendance containers must not be horizontally scrollable`);
    if (width <= 1099) {
      assert.equal(layout.rowDisplay, 'grid', `${width}x${height}: each staff member must use a vertically stacked card`);
      assert.equal(layout.firstReportRowDisplay, 'grid', `${width}x${height}: report details must also be vertically accessible`);
      assert.deepEqual(layout.fields.map((field) => field.label), ['STAFF ID', 'STAFF NAME/MEMBER', 'POSITION/ROLE', 'ATTENDANCE STATUS', 'REPORTING TIME', 'REASONS/REMARKS'], `${width}x${height}: exact six-field order must be preserved`);
      assert.ok(layout.fields.every((field) => field.visible && field.labelAboveValue), `${width}x${height}: every field label must be visible above its value or control`);
      assert.ok(layout.fields.every((field, index, items) => index === 0 || field.top >= items[index - 1].top), `${width}x${height}: fields must proceed vertically`);
      assert.ok(layout.reportLabelVisible, `${width}x${height}: report field labels must remain visible`);
    } else {
      assert.equal(layout.rowDisplay, 'table-row', `${width}x${height}: desktop table presentation must be preserved`);
    }
  }

  await page.setViewportSize({ width: 320, height: 800 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  const enlargedText = await page.evaluate(() => ({
    width: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    pageWidth: document.querySelector('.staff-attendance-page').scrollWidth,
    pageClientWidth: document.querySelector('.staff-attendance-page').clientWidth
  }));
  assert.ok(enlargedText.documentWidth <= enlargedText.width + 1, '320px layout must reflow without document overflow at 200% text size');
  assert.ok(enlargedText.bodyWidth <= enlargedText.width + 1, '320px body must reflow without horizontal scrolling at 200% text size');
  assert.ok(enlargedText.pageWidth <= enlargedText.pageClientWidth + 1, 'attendance page must reflow without horizontal scrolling at 200% text size');
  assert.deepEqual(pageErrors, [], `page script must remain free of runtime errors: ${pageErrors.join('; ')}`);
  await context.close();
});
