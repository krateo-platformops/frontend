/**
 * Test fixtures: the two request-access pages' Form widgetData, as the approved design writes them
 * (the intake contract of identity-lifecycle#28 and the approved mockup copy). They are a worked
 * proof that the `fieldChecks` / `submitPost` / `fieldHelp` surface expresses a real pair of
 * pages; nothing in the Form knows about them.
 */
import type { FormWidgetData } from './Form'

export const INTAKE = '/request-access/api/v1/'

/* eslint-disable sort-keys/sort-keys-fix -- the property order is the field order */
const REQUEST_SCHEMA = {
  type: 'object',
  required: ['firstName', 'lastName', 'email', 'company', 'country', 'useCase', 'consentProcessing'],
  properties: {
    firstName: { type: 'string', title: 'First name' },
    lastName: { type: 'string', title: 'Last name' },
    email: { type: 'string', title: 'Email' },
    company: { type: 'string', title: 'Company' },
    country: { type: 'string', title: 'Country', enum: ['AT', 'BE', 'CH', 'DE', 'ES', 'FR', 'GB', 'IE', 'IT', 'NL', 'PT', 'US'] },
    phone: { type: 'string', title: 'Phone' },
    useCase: { type: 'string', title: 'What would you like to use it for?' },
    consentProcessing: { type: 'boolean', title: 'I agree that Krateo S.r.l. processes the details in this form. See the privacy policy.' },
    consentNewsletter: { type: 'boolean', title: 'Send me occasional news about Krateo and Agentiko. I can unsubscribe at any time.' },
  },
}
/* eslint-enable sort-keys/sort-keys-fix */

const RULE_MESSAGES = {
  charset: 'Use only lowercase letters, digits and dashes.',
  'dns-label': 'Start and end with a letter or a digit.',
  length: 'Use 3 to 56 characters.',
  reserved: 'That name is reserved.',
}

const EXPIRED_RESULT = {
  extra: [{ href: '/public/request-access', kind: 'button' as const, label: 'Request access again' }],
  status: 'warning' as const,
  title: 'This link has expired or was already used.',
}

/** Screen 1, `/public/request-access`: the request form. */
export const REQUEST_FORM: FormWidgetData = {
  buttonConfig: { primary: { label: 'Request access' } },
  checkboxes: [
    { link: { href: 'https://agentiko.eu/privacy-policy/', text: 'privacy policy' }, name: 'consentProcessing', requiredMessage: "Please agree to the processing of your details; we can't review a request without it." },
    { name: 'consentNewsletter' },
  ],
  fieldHelp: [{ name: 'phone', text: 'Start with + and your country code. Spaces are fine.' }],
  requiredMark: 'optional',
  stringSchema: JSON.stringify(REQUEST_SCHEMA),
  submitPost: {
    otherwise: { alert: { description: 'Something went wrong on our side. Your details are still here, so try again later.', title: "We couldn't send your request", type: 'error' } },
    path: `${INTAKE}requests`,
    responses: [
      { result: { icon: 'fa-envelope', status: 'info', subtitle: "We've sent a link to confirm your email address. After you confirm, an administrator reviews your request; if it's approved, you'll get an email to set your password and sign in.", title: 'Check your inbox' }, when: { status: [202] } },
      {
        fieldErrors: {
          fieldMessages: { company: 'Enter your company.', country: 'Choose your country.', email: 'Enter a valid email address, like jane@example.com.', firstName: 'Enter your first name.', lastName: 'Enter your last name.', phone: 'Enter the number with its country code, like +39 …', useCase: "Tell us what you'd like to use it for." },
          message: 'Check this field.',
          namesFrom: 'fields',
        },
        when: { status: [400] },
      },
      { alert: { description: "We've had too many requests in a short time. Wait a while, then try again.", retryAfterDescription: "We've had too many requests in a short time. Try again in {retryAfter}.", title: 'Too many requests', type: 'warning' }, when: { status: [429] } },
    ],
  },
}

/** Screen 2, `/public/request-access-confirm` (its root declares `krateo.io/fragment-keys: "s,t"`). */
export const CONFIRM_FORM: FormWidgetData = {
  buttonConfig: { primary: { label: 'Confirm and send request' } },
  fieldChecks: [{
    answers: [
      { message: '{value} is available.', validateStatus: 'success', when: { bodyField: 'status', equals: ['available'], status: [200] } },
      { message: 'That username is taken. Try another.', validateStatus: 'error', when: { bodyField: 'status', equals: ['unavailable'], status: [200] } },
      { message: "You've used up this link's availability checks. You can still submit; if the name is taken we'll tell you.", validateStatus: 'warning', when: { bodyField: 'status', equals: ['limit'], status: [200] } },
      { result: EXPIRED_RESULT, when: { bodyField: 'status', equals: ['expired'], status: [200] } },
      { message: 'Check this username.', ruleFrom: 'rule', ruleMessages: RULE_MESSAGES, validateStatus: 'error', when: { status: [400] } },
      { message: 'Too many requests right now. Wait a moment and try again.', retryAfterMessage: 'Too many requests right now. Try again in {retryAfter}.', validateStatus: 'warning', when: { status: [429] } },
    ],
    bodyExtras: { submission: 's', token: 't' },
    name: 'username',
    otherwise: { message: "We couldn't check that name right now.", validateStatus: 'warning' },
    path: `${INTAKE}username-checks`,
  }],
  fieldHelp: [{ name: 'username', text: "Lowercase letters, digits and dashes, 3–56 characters. You'll sign in with it." }],
  stringSchema: JSON.stringify({ properties: { username: { title: 'Username', type: 'string' } }, required: ['username'], type: 'object' }),
  submitPost: {
    bodyExtras: { submission: 's', token: 't' },
    otherwise: { alert: { description: 'Your username is still here. Try again in a moment.', title: "We couldn't send your request just now", type: 'warning' } },
    path: `${INTAKE}confirmations`,
    responses: [
      { result: { status: 'success', subtitle: "Your username will be {body.username}. We'll email you when it's approved.", title: 'Thanks — your request is with an administrator.' }, when: { bodyField: 'status', equals: ['filed'], status: [200] } },
      { fieldErrors: { message: 'That username is taken. Try another.', names: ['username'] }, when: { bodyField: 'status', equals: ['unavailable'], status: [200] } },
      { result: EXPIRED_RESULT, when: { bodyField: 'status', equals: ['expired'], status: [200] } },
      {
        result: {
          extra: [{ href: '/login', kind: 'link', label: 'Sign in', text: 'Already have an account?' }],
          status: 'warning',
          subtitle: 'You tried 3 usernames that were already taken. You can request access again tomorrow, once this link has expired.',
          title: 'This link has used up its tries',
        },
        when: { bodyField: 'status', equals: ['limit'], status: [200] },
      },
      { fieldErrors: { message: 'Check this username.', namesFrom: 'fields', ruleFrom: 'rule', ruleMessages: RULE_MESSAGES }, when: { status: [400] } },
      { alert: { description: 'Wait a moment and try again. Your username is still here.', retryAfterDescription: 'Try again in {retryAfter}. Your username is still here.', title: 'Too many requests right now', type: 'warning' }, when: { status: [429] } },
    ],
  },
}
