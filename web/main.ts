import { Controller } from './controller';
import { mountShell } from './shell';

const root = document.getElementById('app');
if (!root) throw new Error('The application mount point is missing.');
const controller = new Controller();
mountShell(root, controller);
void controller.initialize();
window.addEventListener('popstate', () => {
  if (controller.blocked || !controller.canRefresh || controller.dirty) {
    const ref = controller.ref;
    history.pushState(null, '', ref ? `/${controller.route === 'chosen' ? 'chosen' : 'compare'}/${ref.mode}/${ref.id}` : '/');
    return;
  }
  void controller.initialize();
});
window.addEventListener('beforeunload', event => {
  if (controller.pending || controller.busy || controller.transitioning || controller.dirty) { event.preventDefault(); event.returnValue = ''; }
});
