import { mount } from 'svelte';
import '@fontsource-variable/fraunces/opsz.css';
import '@fontsource-variable/inter/wght.css';
import './app.css';
import App from './App.svelte';

// Marks the first page, so "Back" on a page opened straight from a notification goes Home.
if (!history.state) history.replaceState('root', '');

mount(App, { target: document.getElementById('app')! });
