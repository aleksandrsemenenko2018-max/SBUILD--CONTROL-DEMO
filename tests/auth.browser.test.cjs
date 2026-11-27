const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const { launchBrowser, openPage, siteOrigin } = require('./browser-fixture.cjs');

const email = 'browser-test@example.invalid';
const password = 'mock-password';
const phone = '+380000000000';
const otp = '123456';
const user = {
  id: '00000000-0000-4000-8000-000000000001',
  email,
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
};
const session = {
  access_token: 'mock-local-token',
  refresh_token: 'mock-local-refresh',
  expires_in: 3600,
  token_type: 'bearer',
  user,
};

function mockAuth(scenario) {
  return ({ method, pathname, searchParams, body }) => {
    const hasCredentials = body?.email === email && body?.password === password;
    if (method === 'POST' && pathname === '/auth/v1/token' && searchParams.get('grant_type') === 'password' && hasCredentials) {
      if (scenario === 'invalid password') {
        return { status: 400, json: { code: 'invalid_credentials', msg: 'Invalid login credentials' } };
      }
      if (scenario === 'password login') return { json: session };
    }
    if (method === 'POST' && pathname === '/auth/v1/signup' && hasCredentials) {
      if (scenario === 'registration error') {
        return { status: 422, json: { code: 'user_already_exists', msg: 'User already registered' } };
      }
      if (scenario === 'email registration') return { json: user };
    }
    if (scenario === 'email registration' && method === 'POST' && pathname === '/auth/v1/resend' && body?.type === 'signup' && body.email === email) {
      return { json: {} };
    }
    if (scenario === 'phone registration' && method === 'POST') {
      if (pathname === '/auth/v1/otp' && body?.phone === phone && body.create_user === true) {
        return { json: {} };
      }
      if (pathname === '/auth/v1/verify' && body?.phone === phone && body.token === otp && body.type === 'sms') {
        return { json: session };
      }
    }
    if (method === 'GET' && ['password login', 'phone registration'].includes(scenario)) {
      if (pathname === '/auth/v1/user') return { json: user };
      if (pathname === '/rest/v1/sbuild_profiles') {
        return { json: [{ full_name: 'Test Worker', role: 'worker', active: true }] };
      }
      if (pathname.startsWith('/rest/v1/')) return { json: [] };
    }
  };
}

const login = async page => {
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
};

const status = (page, text) => page.locator('#status').filter({ hasText: text }).waitFor();

async function checkWorkspace(page, submit) {
  const reportResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/rest/v1/sbuild_work_reports' && response.ok());
  await Promise.all([reportResponse, submit()]);
  await page.locator('#auth').waitFor({ state: 'hidden' });
  await page.locator('#workspace:not(.hidden)').waitFor({ state: 'attached' });
  await page.locator('#identity').filter({ hasText: 'Test Worker' }).waitFor({ state: 'attached' });
}

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

for (const file of ['index.html', 'app.html', 'premium-dashboard.html', 'director.html']) {
  describe(file, { concurrency: true }, () => {
    function scenario(name, check) {
      it(name, async t => {
        const fixture = await openPage(browser, mockAuth(name));
        t.after(() => fixture.context.close());
        await fixture.page.goto(siteOrigin + '/' + file, { waitUntil: 'domcontentloaded' });
        await fixture.page.waitForFunction(() => typeof document.getElementById('login').onsubmit === 'function');
        await check(fixture.page, fixture.seen);
        fixture.assertClean();
      });
    }

    scenario('password login', async page => {
      await login(page);
      await checkWorkspace(page, () => page.getByRole('button', { name: 'Увійти', exact: true }).click());
    });

    scenario('invalid password', async page => {
      await login(page);
      await page.getByRole('button', { name: 'Увійти', exact: true }).click();
      await status(page, /Невірний email або пароль|Invalid login credentials/);
      assert.equal(await page.locator('#workspace').isVisible(), false);
    });

    async function submitEmail(page) {
      if (file === 'director.html') {
        await login(page);
        await page.locator('#signup').click();
        return;
      }
      await page.locator('#showSignup').click();
      await page.locator('#signupEmail').fill(email);
      await page.locator('#signupPassword').fill(password);
      await page.locator('#signupSubmit').click();
    }

    scenario('email registration', async (page, seen) => {
      await submitEmail(page);
      if (file === 'director.html') {
        await status(page, 'Перевірте пошту');
      } else {
        await status(page, 'Реєстрацію подано');
        await page.locator('#resendEmail').click();
        await status(page, 'Запит на повторний лист надіслано');
        assert.ok(seen.some(request => request.pathname === '/auth/v1/resend'));
      }
      assert.ok(seen.some(request => request.pathname === '/auth/v1/signup'));
      assert.equal(await page.locator('#workspace').isVisible(), false);
    });

    scenario('registration error', async page => {
      await submitEmail(page);
      await status(page, 'User already registered');
      assert.equal(await page.locator('#workspace').isVisible(), false);
    });

    if (file !== 'director.html') {
      scenario('phone registration', async (page, seen) => {
        await page.locator('#showSignup').click();
        const method = page.locator('#signupMethod');
        const required = () => page.locator('#signupEmail, #signupPassword').evaluateAll(inputs =>
          inputs.map(input => input.required));
        assert.deepEqual(await required(), [true, true]);
        await method.selectOption('phone');
        assert.deepEqual(await required(), [false, false]);
        await method.selectOption('email');
        assert.deepEqual(await required(), [true, true]);
        await method.selectOption('phone');

        const number = page.locator('#signupPhone');
        const submit = page.locator('#signupSubmit');
        await number.fill('+380');
        await submit.click();
        await status(page, 'Введіть номер у форматі');
        assert.deepEqual(seen, []);

        const code = page.locator('#phoneOtp');
        const verify = page.locator('#verifyPhoneForm');
        const requestCode = async formattedNumber => {
          await number.fill(formattedNumber);
          await submit.click();
          await status(page, 'SMS-код відправлено');
          await verify.waitFor();
        };

        await requestCode('+38 (000) 000-00-00');
        await code.fill(otp);
        await number.fill(phone);
        assert.equal(await verify.isVisible(), true);
        await number.fill('+380100000000');
        await verify.waitFor({ state: 'hidden' });
        assert.equal(await code.inputValue(), '');

        await requestCode(phone);
        await code.fill(otp);
        await method.selectOption('email');
        await verify.waitFor({ state: 'hidden' });
        assert.equal(await code.inputValue(), '');
        await method.selectOption('phone');

        await requestCode('+380 00 000 00 00');
        await code.fill(otp);
        await checkWorkspace(page, () => verify.locator('button').click());
        const authPaths = seen.filter(request => request.method === 'POST').map(request => request.pathname);
        assert.deepEqual(authPaths, ['/auth/v1/otp', '/auth/v1/otp', '/auth/v1/otp', '/auth/v1/verify']);
      });
    }
  });
}
