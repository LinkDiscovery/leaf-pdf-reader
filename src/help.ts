import help from './help.html?raw';
import { setupTour } from './tour';
export function setupHelp() {
  document.body.insertAdjacentHTML('beforeend', help);
  const dialog = document.querySelector<HTMLDialogElement>('#help-dialog')!;
  const showReference = () => { dialog.showModal(); dialog.scrollTop = 0; };
  const startTour = setupTour(showReference);
  document.getElementById('help-open')!.onclick = startTour;
  document.getElementById('welcome-help')!.onclick = showReference;
  document.getElementById('help-tour')!.onclick = () => { dialog.close(); startTour(); };
  for (const id of ['help-close', 'help-done']) document.getElementById(id)!.onclick = () => dialog.close();
  document.getElementById('help-start')!.onclick = () => { dialog.close(); document.getElementById('open-button')!.click(); };
}
