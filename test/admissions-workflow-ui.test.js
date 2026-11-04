import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SIDEBAR_MODULES } from '../src/sidebar-registry.js';
import { admissionClassSelection, createAdmissionFormNavigator, requiredAdmissionDocumentTypes } from '../public/admission-form-navigation.js';
import '../src/module-registry.js';

const page = await readFile(new URL('../public/admissions.html', import.meta.url), 'utf8');
const applicationPage = await readFile(new URL('../public/admission-application.html', import.meta.url), 'utf8');
const workflow = await readFile(new URL('../public/admissions-workflow.js', import.meta.url), 'utf8');
const application = await readFile(new URL('../public/admission-application.js', import.meta.url), 'utf8');
const navigation = await readFile(new URL('../public/admission-form-navigation.js', import.meta.url), 'utf8');

test('Next validates the enquiry, prevents duplicate requests, and opens the official application form', () => {
  assert.match(page, /id="admission-enquiry"/);
  assert.match(page, />Next<\/button>/);
  assert.doesNotMatch(page, /Start Application/);
  assert.match(workflow, /normalizeGhanaPhone/);
  assert.match(workflow, /enquiryRequestId/);
  assert.match(workflow, /jsonRequest\('\/api\/admission-applications', \{ method: 'POST', headers: \{ 'Content-Type': 'application\/json' \}, body: JSON\.stringify\(payload\) \}\)/);
  assert.match(workflow, /window\.location\.assign\(`\/admission-application\.html\?applicationNumber=\$\{encodeURIComponent\(created\.applicationNumber\)\}&step=2`\)/);
  assert.match(workflow, /window\.location\.assign\(`\/admission-application\.html\?applicationNumber=.*step=2`\)/);
  assert.match(workflow, /if \(submitting\) return/);
  assert.match(workflow, /Saving enquiry/);
  assert.match(applicationPage, /<script type="module" src="\/admission-application\.js"><\/script>/);
  assert.match(application, /nextButton\.addEventListener\('click', handleNext\)/);
  assert.match(application, /backButton\.addEventListener\('click', \(\) => \{/);
  assert.match(application, /window\.location\.assign\(`\/admissions\?applicationNumber=/);
  assert.match(application, /if \(wizard\.next\(\)\)/);
  assert.match(application, /form\.noValidate = true/);
  assert.match(application, /showReview\(\)/);
  assert.match(application, /data-confirm-admission/);
  assert.match(navigation, /minimumAdvanceInterval = 250/);
  assert.match(workflow, /reopenExistingEnquiry/);
  assert.match(workflow, /savedApplicationNumber.*\/update/s);
});

test('staff intake distinguishes all three categories and carries category-specific details without requiring insurance number', () => {
  assert.match(page, /value="ALREADY_ENROLLED">Already enrolled at OsaaH/);
  assert.match(page, /value="TRANSFER">Transfer from another school/);
  assert.match(page, /value="FIRST_TIME">First-time applicant/);
  assert.match(page, /name="historicalAdmissionYear"[^>]*required|name="historicalAdmissionYear"/);
  assert.match(page, /data-category-field="TRANSFER"[^>]*Previous school|Previous school<input name="previousSchool"/);
  assert.match(page, /Health Insurance Number <span class="muted">\(optional\)/);
  assert.doesNotMatch(page.match(/name="healthInsuranceNumber"[^>]*>/)?.[0] ?? '', /required/);
  assert.match(workflow, /syncAdmissionCategory/);
  assert.match(workflow, /historicalAdmissionYear/);
  assert.match(workflow, /previousSchool/);
  assert.match(workflow, /healthInsuranceNumber/);
  assert.match(workflow, /if \(submitting\) return/);
});

test('public registration uses a guest-safe options fallback and does not render raw authorization errors', () => {
  assert.match(workflow, /\/api\/public\/admission-workflow\/options/);
  assert.match(workflow, /Unable to load school classes and years\. Please retry\./);
  assert.doesNotMatch(workflow, /Unable to load school classes and years: \$\{error\.message\}/);
});

test('admission form navigation advances only after validation and preserves values when going Back', () => {
  let timestamp = 0;
  const steps = [{ value: 'Ama' }, { value: 'Bogoso' }, { value: 'Guardian' }];
  const validity = [false, true, true];
  const changes = [];
  const wizard = createAdmissionFormNavigator({
    steps,
    validateStep: (_step, index) => validity[index],
    onStepChange: ({ currentStep }) => changes.push(currentStep),
    now: () => timestamp,
  });

  assert.equal(wizard.currentStep, 0);
  assert.equal(steps[0].hidden, false);
  assert.equal(steps[1].hidden, true);
  assert.equal(wizard.next(), false, 'invalid fields must keep the current section open');
  assert.equal(wizard.currentStep, 0);

  validity[0] = true;
  assert.equal(wizard.next(), true);
  assert.equal(wizard.currentStep, 1);
  assert.equal(steps[0].hidden, true);
  assert.equal(steps[1].hidden, false);
  assert.equal(wizard.next(), false, 'rapid repeated clicks must not skip a section');
  assert.equal(wizard.currentStep, 1);

  timestamp = 300;
  assert.equal(wizard.next(), true);
  assert.equal(wizard.currentStep, 2);
  assert.equal(wizard.back(), true);
  assert.equal(wizard.currentStep, 1);
  assert.deepEqual(steps.map((step) => step.value), ['Ama', 'Bogoso', 'Guardian']);
  assert.deepEqual(changes, [0, 1, 2, 1]);
});

test('canonical class option IDs are submitted as the class name expected by both admission services', () => {
  const select = { value: 'class-basic-2', selectedOptions: [{ textContent: 'Basic 2' }] };
  assert.deepEqual(admissionClassSelection(select), { classAppliedFor: 'Basic 2', className: 'Basic 2' });
  assert.deepEqual(admissionClassSelection({ value: '', selectedOptions: [{ textContent: 'Select class' }] }), { classAppliedFor: '', className: '' });
  assert.match(workflow, /classAppliedFor: className/);
  assert.match(application, /Object\.assign\(data, admissionClassSelection\(classField\)\)/);
});

test('admission type controls the client guidance without changing server-side document enforcement', () => {
  assert.deepEqual(requiredAdmissionDocumentTypes({ admissionType: 'ALREADY_ENROLLED', className: 'Primary 4' }), []);
  assert.deepEqual(requiredAdmissionDocumentTypes({ admissionType: 'TRANSFER', className: 'Primary 4' }), [
    'PASSPORT_PHOTOGRAPHS', 'BIRTH_CERTIFICATE_OR_GHANA_CARD', 'NHIS_CARD', 'LAST_ACADEMIC_REPORT', 'ADMISSION_RECEIPT',
  ]);
  assert.deepEqual(requiredAdmissionDocumentTypes({ admissionType: 'FIRST_TIME', className: 'Nursery 1' }), [
    'PASSPORT_PHOTOGRAPHS', 'BIRTH_CERTIFICATE_OR_GHANA_CARD', 'NHIS_CARD', 'ADMISSION_RECEIPT',
  ]);
  assert.deepEqual(requiredAdmissionDocumentTypes({ className: 'JHS 1' }), [
    'PASSPORT_PHOTOGRAPHS', 'BIRTH_CERTIFICATE_OR_GHANA_CARD', 'NHIS_CARD', 'LAST_ACADEMIC_REPORT',
  ]);
  assert.match(application, /missingRequiredDocuments\(\{ uploadedOnly: true \}\)/);
  assert.match(application, /\/submit/);
  assert.match(application, /await uploadSelectedDocuments\(\)/);
});

test('application drafts reopen and private document uploads transmit bytes through the storage API', () => {
  assert.match(application, /populate\(await request\(`\/api\/admission-applications\/\$\{encodeURIComponent\(applicationNumber\)\}`\)\)/);
  assert.match(application, /Save Draft/);
  assert.match(application, /uploadSelectedDocuments/);
  assert.match(application, /body: file/);
  assert.match(application, /X-Document-Type/);
  assert.doesNotMatch(application, /fileReference:\s*file\.name/);
  assert.match(applicationPage, /id="document-storage-status"/);
  assert.match(applicationPage, /10 MB maximum per file/);
});

test('three leadership roles share the Student Management workflow and retain separate Prospectus navigation', () => {
  const admission = SIDEBAR_MODULES.find((item) => item.moduleKey === 'admissions');
  const prospectus = SIDEBAR_MODULES.find((item) => item.moduleKey === 'admission-prospectus');
  assert.ok(admission);
  for (const role of ['PROPRIETOR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER']) assert.ok((admission.allowedRoles ?? admission.roles).includes(role));
  assert.equal(admission.route, '/admissions');
  assert.ok(prospectus);
  assert.notEqual(prospectus.route, admission.route);
});
