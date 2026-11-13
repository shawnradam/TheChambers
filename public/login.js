const form = document.getElementById('login');
const errorBox = document.getElementById('error');
const passwordInput = document.getElementById('password');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.textContent = '';
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        password: passwordInput.value,
        trust: document.getElementById('trust').checked,
      }),
    });
    if (res.ok) {
      location.href = '/';
      return;
    }
    const data = await res.json().catch(() => ({}));
    errorBox.textContent = data.error || 'Could not unlock.';
    passwordInput.select();
  } catch {
    errorBox.textContent = 'Could not reach this machine.';
  } finally {
    button.disabled = false;
  }
});

passwordInput.focus();
