import './style.css';
import { mountHost } from './host';
import { mountController } from './controller';
if (location.pathname === '/controller') mountController(); else void mountHost();
