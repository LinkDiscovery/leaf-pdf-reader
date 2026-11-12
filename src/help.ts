import help from './help.html?raw';
export function setupHelp() {
  document.body.insertAdjacentHTML('beforeend', help);
  const dialog = document.querySelector<HTMLDialogElement>('#help-dialog')!;
  for (const id of ['help-open', 'welcome-help']) document.getElementById(id)!.onclick = () => { dialog.showModal(); dialog.scrollTop = 0; };
  for (const id of ['help-close', 'help-done']) document.getElementById(id)!.onclick = () => dialog.close();
  document.getElementById('help-start')!.onclick = () => { dialog.close(); document.getElementById('open-button')!.click(); };
}
