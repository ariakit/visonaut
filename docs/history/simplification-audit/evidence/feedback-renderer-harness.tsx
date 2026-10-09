import * as React from 'react';
import { createRoot } from 'react-dom/client';
import * as A from '@ariakit/react';
import { CompositeRenderer } from '@ariakit/react-components/composite/composite-renderer';
const items=Array.from({length:1000},(_,index)=>({id:`item-${index}`,label:`Item ${index}`}));
function App(){
 const store=A.useCompositeStore({defaultActiveId:'item-0',orientation:'vertical'});
 React.useEffect(()=>{window.probe={store,items};},[store]);
 return <A.Composite store={store} style={{height:300,width:400,overflow:'auto'}} role="listbox" aria-label="Items"><CompositeRenderer store={store} items={items} itemSize={40} overscan={2}>{({index,label,...item})=><A.CompositeItem {...item} key={item.id} store={store} role="option" render={<a href={`#${item.id}`}/>} style={{...item.style,height:40,boxSizing:'border-box',border:'1px solid',display:'block'}}>{label}</A.CompositeItem>}</CompositeRenderer></A.Composite>
}
createRoot(document.getElementById('root')!).render(<App/>);
