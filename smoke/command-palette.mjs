// Runs inside the isolated smoke browser against the real input event handlers.
export function checkCommandPalette() {
  const input = document.getElementById('feedbackInput');
  const errors = [];
  const onError = (event) => errors.push(event.message);
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const rows = () => [...document.querySelectorAll('#cmdpal .cp-cmd')];
  const visible = () => document.getElementById('cmdpal')?.hidden === false;
  const type = (value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };
  const key = (value) => input.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  window.addEventListener('error', onError);
  try {
    assert(input, 'Command input missing');
    type('/');
    assert(visible() && rows().length > 0, 'Slash did not open commands');
    const commands = rows().map(row => row.textContent);
    // Exercise every current registry entry: a missing optional field must not
    // break unrelated commands that occur later in the list either.
    for (const command of commands) {
      type(command);
      assert(visible() && rows().some(row => row.textContent.startsWith(command)), `Cannot filter ${command}`);
    }
    type('/direc');
    assert(rows()[0]?.textContent === '/transit', 'Alias filtering failed');
    type('/theme ');
    assert(visible() && rows().length >= 2, 'Command options missing');
    type('/');
    key('ArrowDown');
    assert(document.querySelectorAll('#cmdpal .cp-row')[1]?.classList.contains('sel'), 'Arrow selection failed');
    type('/hel');
    key('Tab');
    assert(input.value === '/help', 'Tab completion failed');
    key('Enter');
    assert(input.value === '' && !visible(), 'Enter did not execute selection');
    key('Escape'); // close the help panel
    type('/no-such-command');
    assert(!visible(), 'Unknown command did not hide palette');
    type('/');
    key('Escape');
    assert(!visible(), 'Escape did not close palette');
    assert(errors.length === 0, errors.join('; '));
    return { commands: commands.length };
  } finally {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    window.removeEventListener('error', onError);
  }
}
