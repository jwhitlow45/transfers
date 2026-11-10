import type { ComponentChildren } from 'preact';

// Parts of one line, with a middle dot between them. Where the line wraps, it breaks between
// parts and the dot goes, so no line ends or starts with one (see .tf-dots). Text given with its
// dots already in it, "SamTrans · Until Nov 30", is split at them.
export function Dots({ parts, class: name, tag: Tag = 'span', hidden }: { parts: ComponentChildren[]; class?: string; tag?: 'span' | 'div' | 'p'; hidden?: boolean }) {
  const split = (part: ComponentChildren): ComponentChildren[] => (typeof part === 'string' ? part.split(' · ') : [part]);
  const shown = parts.flatMap(split).filter((part) => part !== null && part !== undefined && part !== false && part !== '');
  return (
    <Tag class={`tf-dots${name ? ` ${name}` : ''}`} aria-hidden={hidden || undefined}>
      {shown.map((part, index) => (
        <span key={index}>{part}</span>
      ))}
    </Tag>
  );
}
