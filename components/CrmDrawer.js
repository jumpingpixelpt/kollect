"use client";
import { useState } from "react";
import CrmPanel from "./CrmPanel";

export default function CrmDrawer(props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="gold-btn crm-open" onClick={() => setOpen(true)}>CRM · Contato ↗</button>
      {open && (
        <div className="drawer-backdrop" onClick={() => setOpen(false)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <div>
                <div className="drawer-title">CRM · {props.creatorName}</div>
                <div className="drawer-sub">@{props.handle} · {props.platform}</div>
              </div>
              <button className="drawer-close" onClick={() => setOpen(false)}>✕</button>
            </div>
            <CrmPanel {...props} bare />
          </aside>
        </div>
      )}
    </>
  );
}
