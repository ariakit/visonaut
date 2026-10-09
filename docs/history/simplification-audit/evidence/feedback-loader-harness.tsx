import * as React from 'react';import {createRoot} from 'react-dom/client';
import {createRootRoute,createRoute,createRouter,createMemoryHistory,RouterProvider,Outlet} from '@tanstack/react-router';
const calls=[];const root=createRootRoute({component:()=> <Outlet/>});
const route=createRoute({getParentRoute:()=>root,path:'/runs/$runId',validateSearch:s=>({comparison:s.comparison,item:s.item,variant:s.variant}),loaderDeps:({search})=>({comparison:search.comparison}),loader:({params,deps,abortController,cause})=>{calls.push({params,deps,cause,signal:abortController.signal.aborted});return {value:calls.length}},component:()=> <div id="loaded">Ready</div>});
const router=createRouter({routeTree:root.addChildren([route]),history:createMemoryHistory({initialEntries:['/runs/a?comparison=c&item=one&variant=v']})});window.probe={calls,router};createRoot(document.getElementById('root')).render(<RouterProvider router={router}/>);
