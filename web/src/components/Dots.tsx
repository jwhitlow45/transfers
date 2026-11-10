import { type ComponentChildren, Fragment } from 'preact';
import { Groups, Whole } from './Whole.tsx';

// Parts of one line, with a middle dot between them. They run on as words do. A part that fits a
// line never splits, and one too long for a line wraps inside itself, with the parts after it on
// its last line (see Whole). Where the line breaks between two parts the dot goes, so no line ends
// or starts with one (see .tf-dots). Text given with its dots already in it, "SamTrans · Until
// Nov 30", is split at them.
export function Dots({ parts, class: name, tag: Tag = 'span', hidden }: { parts: ComponentChildren[]; class?: string; tag?: 'span' | 'div' | 'p'; hidden?: boolean }) {
  const split = (part: ComponentChildren): ComponentChildren[] => (typeof part === 'string' ? part.split(' · ') : [part]);
  const shown = parts.flatMap(split).filter((part) => part !== null && part !== undefined && part !== false && part !== '');
  return (
    <Tag class={`tf-dots${name ? ` ${name}` : ''}`} aria-hidden={hidden || undefined}>
      {shown.map((part, index) => (
        <Fragment key={index}>
          {/* The room between two parts is a space, which a line break takes with it. */}
          {index > 0 && <span class="tf-dots__gap"> </span>}
          <Whole class={index > 0 ? 'tf-dots__part tf-dots__part--next' : 'tf-dots__part'}>{typeof part === 'string' ? <Groups text={part} /> : part}</Whole>
        </Fragment>
      ))}
    </Tag>
  );
}
