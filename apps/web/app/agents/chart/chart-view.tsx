"use client";

import type { Agent } from "@aidevteam/contracts";
import { useRouter } from "next/navigation";
import { useState, type DragEvent, type FormEvent } from "react";
import { sendJson } from "../../../lib/api-errors";
import { buildOrgTree, canDrop, type OrgTreeNode } from "../../../lib/org-tree";

interface OrgChartProps {
  agents: Agent[];
  canWrite: boolean;
}

export function OrgChart({ agents, canWrite }: OrgChartProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const tree = buildOrgTree(agents);

  async function moveAgent(dragSlug: string, targetSlug: string | null) {
    if (!canDrop(tree, dragSlug, targetSlug)) {
      setError("Không thể chọn cấp trên này: sẽ tạo vòng lặp trong sơ đồ tổ chức.");
      return;
    }
    setSaving(true);
    setError(null);
    const r = await sendJson("PATCH", `/api/agents/${encodeURIComponent(dragSlug)}`, {
      reportsToSlug: targetSlug,
    });
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.refresh();
  }

  function onDropRoot(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    const dragSlug = e.dataTransfer.getData("text/plain");
    if (dragSlug) void moveAgent(dragSlug, null);
  }

  function onDropNode(e: DragEvent<HTMLElement>, targetSlug: string) {
    e.preventDefault();
    e.stopPropagation();
    const dragSlug = e.dataTransfer.getData("text/plain");
    if (dragSlug && dragSlug !== targetSlug) {
      void moveAgent(dragSlug, targetSlug);
    }
  }

  return (
    <>
      {error ? (
        <p role="alert" style={{ color: "#c00", fontWeight: "bold" }}>
          {error}
        </p>
      ) : null}

      {canWrite ? (
        <div
          role="region"
          aria-label="Không có quản lý (gốc)"
          data-testid="drop-root"
          onDragOver={canWrite && !saving ? (e) => e.preventDefault() : undefined}
          onDrop={canWrite && !saving ? onDropRoot : undefined}
          style={{
            border: "2px dashed #0066cc",
            borderRadius: "4px",
            padding: "1rem",
            marginBottom: "1.5rem",
            background: "#f0f7ff",
            textAlign: "center",
          }}
        >
          <strong>Không có quản lý (gốc)</strong>
          <p style={{ margin: "0.25rem 0 0" }}>Kéo agent vào đây để đặt làm agent gốc (không có cấp trên).</p>
        </div>
      ) : null}

      <div data-testid="org-tree">
        {tree.length === 0 ? (
          <p>Chưa có agent nào.</p>
        ) : (
          <ul style={{ listStyle: "none", paddingLeft: 0, margin: 0 }}>
            {tree.map((node) => (
              <li key={node.slug} style={{ marginBottom: "0.75rem" }}>
                <TreeNodeItem
                  node={node}
                  tree={tree}
                  agents={agents}
                  canWrite={canWrite}
                  saving={saving}
                  onDropNode={onDropNode}
                  moveAgent={moveAgent}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function TreeNodeItem({
  node,
  tree,
  agents,
  canWrite,
  saving,
  onDropNode,
  moveAgent,
}: {
  node: OrgTreeNode;
  tree: OrgTreeNode[];
  agents: Agent[];
  canWrite: boolean;
  saving: boolean;
  onDropNode: (e: DragEvent<HTMLElement>, targetSlug: string) => void;
  moveAgent: (dragSlug: string, targetSlug: string | null) => Promise<void>;
}) {
  return (
    <div
      data-testid={`agent-node-${node.slug}`}
      draggable={canWrite && !saving ? true : undefined}
      onDragStart={
        canWrite && !saving
          ? (e) => {
              e.dataTransfer.setData("text/plain", node.slug);
            }
          : undefined
      }
      onDragOver={canWrite && !saving ? (e) => e.preventDefault() : undefined}
      onDrop={canWrite && !saving ? (e) => onDropNode(e, node.slug) : undefined}
      style={{
        border: "1px solid #ccc",
        borderRadius: "4px",
        padding: "0.75rem",
        background: node.enabled ? "#fff" : "#f9f9f9",
        cursor: canWrite ? "grab" : "default",
      }}
    >
      <div>
        <strong>{node.name}</strong> <code>({node.slug})</code>
      </div>
      <div>
        <small>
          Chức danh: {node.title ?? "—"} · Trạng thái: {node.enabled ? "Đang bật" : "Đã tắt"}
          {node.cycle ? " · (Vòng lặp)" : ""}
        </small>
      </div>

      {canWrite ? (
        <div style={{ marginTop: "0.5rem" }}>
          <KeyboardControl node={node} tree={tree} agents={agents} saving={saving} onMove={moveAgent} />
        </div>
      ) : null}

      {node.children.length > 0 ? (
        <ul style={{ listStyle: "none", paddingLeft: "1.5rem", marginTop: "0.75rem", borderLeft: "2px solid #ddd" }}>
          {node.children.map((child) => (
            <li key={child.slug} style={{ marginTop: "0.5rem" }}>
              <TreeNodeItem
                node={child}
                tree={tree}
                agents={agents}
                canWrite={canWrite}
                saving={saving}
                onDropNode={onDropNode}
                moveAgent={moveAgent}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function KeyboardControl({
  node,
  tree,
  agents,
  saving,
  onMove,
}: {
  node: OrgTreeNode;
  tree: OrgTreeNode[];
  agents: Agent[];
  saving: boolean;
  onMove: (dragSlug: string, targetSlug: string | null) => Promise<void>;
}) {
  const validManagers = agents.filter(
    (a) => a.slug !== node.slug && canDrop(tree, node.slug, a.slug),
  );

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const target = String(d.get("reportsToSlug") ?? "");
    void onMove(node.slug, target ? target : null);
  }

  const hasValidCurrent = node.reportsToSlug && validManagers.some((m) => m.slug === node.reportsToSlug);

  return (
    <form onSubmit={onSubmit} aria-label={`Đổi cấp trên ${node.slug}`} style={{ display: "inline-block" }}>
      <label>
        Báo cáo cho:{" "}
        <select
          name="reportsToSlug"
          aria-label="Báo cáo cho"
          defaultValue={hasValidCurrent ? node.reportsToSlug! : ""}
          disabled={saving}
        >
          <option value="">(gốc - không có quản lý)</option>
          {validManagers.map((m) => (
            <option key={m.slug} value={m.slug}>
              {m.name} ({m.slug})
            </option>
          ))}
        </select>
      </label>{" "}
      <button type="submit" disabled={saving}>
        Lưu
      </button>
    </form>
  );
}
