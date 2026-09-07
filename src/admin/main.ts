import '../app/style.css';
import './admin.css';

import { mountDashboard } from './dashboard.ts';

mountDashboard(document.querySelector<HTMLElement>('#admin')!);
