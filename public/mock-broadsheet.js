const form = document.querySelector('#filters');
const out = document.querySelector('#output');
const status = document.querySelector('#status');
let options = {};
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[character]));
async function api(url) { const response = await fetch(url); const body = await response.json().catch(() => ({ error: 'Request failed.' })); if (!response.ok) throw Error(body.error || 'Request failed.'); return body; }
const download = (filename, content, type = 'text/csv') => { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([content], { type })); link.download = filename; link.click(); URL.revokeObjectURL(link.href); };
const csvCell = (value) => JSON.stringify(value ?? '');
const optionId = (item) => String(item?.id ?? item?.name ?? item ?? '');
const optionName = (item) => String(item?.name ?? item?.label ?? item ?? '');
function renderTerms(selected = '') {
  const yearId = form.elements.academicYear.value;
  const terms = (options.terms || []).filter((item) => !item.academicYearId || !yearId || String(item.academicYearId) === yearId);
  form.elements.term.innerHTML = '<option value="">Select term</option>' + terms.map((item) => `<option value="${esc(optionId(item))}">${esc(optionName(item))}</option>`).join('');
  form.elements.term.value = terms.some((item) => optionId(item) === selected) ? selected : optionId(terms.find((item) => item.isCurrent) || terms[0] || '');
}
function render(rows) {
  const subjects = [...new Set(rows.flatMap((row) => Object.keys(row.subjectTotals || {})))];
  const stats = rows[0]?.classGenderDistribution || { totalBoys: 0, totalGirls: 0, totalStudents: rows.length };
  const headers = ['OSAAH STUDENT INDEX', 'STUDENT NAME', 'GENDER', ...subjects.flatMap((subject) => [`${subject} Total`, `${subject} Grade`]), 'TOTAL SCORE', 'AGGREGATE', 'CLASS POSITION'];
  const body = rows.map((row) => `<tr><td>${esc(row.permanentStudentId)}</td><td>${esc(row.studentName)}</td><td>${esc(row.gender || 'Not Recorded')}</td>${subjects.map((subject) => `<td>${esc(row.subjectTotals?.[subject] ?? '—')}</td><td>${esc(row.subjectGrades?.[subject] ?? '—')}</td>`).join('')}<td>${esc(row.totalScore)}</td><td>${esc(row.aggregate ?? 'N/A')}</td><td>${esc(row.classPosition ?? '—')}</td></tr>`).join('') || '<tr><td colspan="6">No mock results found.</td></tr>';
  out.className = 'card broadsheet-output';
  out.innerHTML = `${rows.some((row) => row.isSample) ? '<p><strong>SAMPLE / TEST MODE — isolated demo results</strong></p>' : ''}<div class="broadsheet-actions"><button class="text-button" id="mock-print" type="button">Print Mock Broadsheet</button><button class="text-button" id="mock-pdf" type="button">Export PDF</button><button class="text-button" id="mock-csv" type="button">Export CSV</button></div><div class="gender-summary"><span>TOTAL BOYS IN CLASS: ${esc(stats.totalBoys)}</span><span>TOTAL GIRLS IN CLASS: ${esc(stats.totalGirls)}</span><span>TOTAL STUDENTS IN CLASS: ${esc(stats.totalStudents)}</span></div><div class="table-scroll"><table><thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
  const csvRows = [headers, ...rows.map((row) => [row.permanentStudentId, row.studentName, row.gender || 'Not Recorded', ...subjects.flatMap((subject) => [row.subjectTotals?.[subject] ?? '', row.subjectGrades?.[subject] ?? '']), row.totalScore, row.aggregate ?? 'N/A', row.classPosition ?? '—'])];
  out.querySelector('#mock-print').onclick = () => window.print();
  out.querySelector('#mock-pdf').onclick = () => window.print();
  out.querySelector('#mock-csv').onclick = () => download(`mock-broadsheet-${form.elements.mockLabel.value || 'results'}.csv`, csvRows.map((row) => row.map(csvCell).join(',')).join('\n'));
}
async function load() {
  options = await api('/api/academic/options');
  const years = options.academicYears || [];
  form.elements.academicYear.innerHTML = '<option value="">Select academic year</option>' + years.map((item) => `<option value="${esc(optionId(item))}">${esc(optionName(item))}</option>`).join('');
  form.elements.academicYear.value = optionId(years.find((item) => item.isCurrent) || years[0] || '');
  renderTerms();
  const classes = (options.classes || []).filter((item) => /^JHS [123]$/.test(optionName(item)));
  form.elements.classId.innerHTML = '<option value="">Select JHS class</option>' + classes.map((item) => `<option value="${esc(optionId(item))}">${esc(optionName(item))}</option>`).join('');
  form.elements.mockLabel.innerHTML = (options.mockTypes || []).map((item) => `<option value="${esc(optionId(item))}">${esc(optionName(item))}</option>`).join('');
}
form.elements.academicYear.addEventListener('change', () => renderTerms());
form.addEventListener('submit', async (event) => { event.preventDefault(); status.textContent = 'Generating…'; try { const query = new URLSearchParams(new FormData(form)); render((await api('/api/academic/mock-broadsheet?' + query)).rows); status.textContent = ''; } catch (error) { status.textContent = error.message; } });
load().catch((error) => { status.textContent = error.message; });
