import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Tabs, TabList, Tab, TabPanel } from '@ui/components/tabs.ariakit.react.tsx';
function App() {
  const read = () => location.hash.slice(1) || 'light';
  const [selected, setSelected] = useState(read);
  useEffect(() => { const update = () => setSelected(read()); addEventListener('hashchange', update); return () => removeEventListener('hashchange', update); }, []);
  return <Tabs selectedId={selected} selectOnMove={false}>
    <TabList aria-label="Variants">
      <Tab id="light" render={<a href="#light" />}>Light</Tab>
      <Tab id="dark" render={<a href="#dark" />}>Dark</Tab>
    </TabList>
    <TabPanel tabId="light">Light image</TabPanel>
    <TabPanel tabId="dark">Dark image</TabPanel>
    <output aria-label="Selected variant">{selected}</output>
  </Tabs>;
}
createRoot(document.getElementById('root')!).render(<App />);
