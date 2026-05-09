'use client';

import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Heading3, Heading4, Italic, List, ListOrdered, Underline } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';

import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TiptapEditorProps {
  /** Initial HTML content for the editor. */
  content: string;
  /** Callback fired on every content change with the current HTML string. */
  onChange: (html: string) => void;
  /** Placeholder text shown when the editor is empty. */
  placeholder?: string;
  /** Accessible label for the editor area. */
  'aria-label'?: string;
}

// ---------------------------------------------------------------------------
// Toolbar action descriptors
// ---------------------------------------------------------------------------

interface ToolbarAction {
  /** Unique key for the action — doubles as the `data-testid` suffix. */
  key: string;
  /** Icon component from Lucide. */
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  /** Accessible label for the button. */
  label: string;
  /** Execute the command on the editor. */
  command: (editor: NonNullable<ReturnType<typeof useEditor>>) => void;
  /** Whether the mark/node is currently active. */
  isActive: (editor: NonNullable<ReturnType<typeof useEditor>>) => boolean;
}

const TOOLBAR_ACTIONS: ToolbarAction[] = [
  {
    key: 'bold',
    icon: Bold,
    label: 'Negrito',
    command: (e) => e.chain().focus().toggleBold().run(),
    isActive: (e) => e.isActive('bold'),
  },
  {
    key: 'italic',
    icon: Italic,
    label: 'Itálico',
    command: (e) => e.chain().focus().toggleItalic().run(),
    isActive: (e) => e.isActive('italic'),
  },
  {
    key: 'underline',
    icon: Underline,
    label: 'Sublinhado',
    command: (e) => e.chain().focus().toggleUnderline().run(),
    isActive: (e) => e.isActive('underline'),
  },
  {
    key: 'heading3',
    icon: Heading3,
    label: 'Título 3',
    command: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
    isActive: (e) => e.isActive('heading', { level: 3 }),
  },
  {
    key: 'heading4',
    icon: Heading4,
    label: 'Título 4',
    command: (e) => e.chain().focus().toggleHeading({ level: 4 }).run(),
    isActive: (e) => e.isActive('heading', { level: 4 }),
  },
  {
    key: 'bulletList',
    icon: List,
    label: 'Lista com marcadores',
    command: (e) => e.chain().focus().toggleBulletList().run(),
    isActive: (e) => e.isActive('bulletList'),
  },
  {
    key: 'orderedList',
    icon: ListOrdered,
    label: 'Lista numerada',
    command: (e) => e.chain().focus().toggleOrderedList().run(),
    isActive: (e) => e.isActive('orderedList'),
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Rich-text editor built on Tiptap with a toolbar following the Sálvia design
 * system. Used primarily for anamnesis and clinical notes (prontuário/evoluções).
 *
 * Accessibility:
 * - Toolbar uses `role="toolbar"` with left/right arrow key navigation.
 * - Editor area has a configurable `aria-label`.
 * - Respects `prefers-reduced-motion` via global CSS (see globals.css).
 */
export function TiptapEditor({
  content,
  onChange,
  placeholder,
  'aria-label': ariaLabel,
}: TiptapEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [3, 4] },
      }),
      Placeholder.configure({
        placeholder: placeholder ?? '',
      }),
    ],
    content,
    immediatelyRender: false,
    onUpdate: ({ editor: e }) => {
      onChange(e.getHTML());
    },
  });

  // Sync external content changes (controlled component pattern).
  // Only update when the editor's current HTML diverges from `content` prop
  // AND the editor is not focused (avoid clobbering mid-typing).
  useEffect(() => {
    if (editor && !editor.isFocused && editor.getHTML() !== content) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
  }, [editor, content]);

  return (
    <div className="flex max-w-[720px] flex-col" data-testid="tiptap-editor">
      {/* Toolbar */}
      {editor && <Toolbar editor={editor} />}

      {/* Editor area */}
      <EditorContent
        editor={editor}
        aria-label={ariaLabel}
        className={cn(
          // Surface & border (design system: Input-like)
          'border-border bg-surface-sunken rounded-md border',
          // Focus ring via Tiptap's ProseMirror class
          '[&_.ProseMirror:focus]:border-brand-500 [&_.ProseMirror:focus]:shadow-focus',
          // Typography: body-lg for clinical text readability
          '[&_.ProseMirror]:min-h-[160px] [&_.ProseMirror]:px-4 [&_.ProseMirror]:py-3',
          '[&_.ProseMirror]:text-[17px] [&_.ProseMirror]:leading-[1.65] [&_.ProseMirror]:font-normal',
          '[&_.ProseMirror]:text-text-primary [&_.ProseMirror]:outline-none',
          // Placeholder styling
          '[&_.ProseMirror_p.is-editor-empty:first-child::before]:text-text-disabled',
          '[&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left',
          '[&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none',
          '[&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0',
          '[&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]',
          // Heading styles
          '[&_.ProseMirror_h3]:text-lg [&_.ProseMirror_h3]:leading-[1.25] [&_.ProseMirror_h3]:font-semibold',
          '[&_.ProseMirror_h4]:text-base [&_.ProseMirror_h4]:leading-[1.25] [&_.ProseMirror_h4]:font-medium',
          // List styles
          '[&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6',
          '[&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6',
        )}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar (internal)
// ---------------------------------------------------------------------------

interface ToolbarProps {
  editor: NonNullable<ReturnType<typeof useEditor>>;
}

/**
 * Formatting toolbar with `role="toolbar"` and arrow-key navigation per
 * WAI-ARIA toolbar pattern. Only the focused button is in the tab order
 * (roving tabindex); left/right arrows move between buttons.
 */
function Toolbar({ editor }: ToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const focusedIndexRef = useRef(0);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;

    const buttons = Array.from(toolbar.querySelectorAll<HTMLButtonElement>('button'));
    if (buttons.length === 0) return;

    let nextIndex = focusedIndexRef.current;

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      nextIndex = (nextIndex + 1) % buttons.length;
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      nextIndex = (nextIndex - 1 + buttons.length) % buttons.length;
    } else if (event.key === 'Home') {
      event.preventDefault();
      nextIndex = 0;
    } else if (event.key === 'End') {
      event.preventDefault();
      nextIndex = buttons.length - 1;
    } else {
      return;
    }

    focusedIndexRef.current = nextIndex;

    // Update roving tabindex
    buttons.forEach((btn, i) => {
      btn.tabIndex = i === nextIndex ? 0 : -1;
    });
    buttons[nextIndex]?.focus();
  }, []);

  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label="Formatação de texto"
      className="mb-1 flex gap-0.5"
      onKeyDown={handleKeyDown}
      data-testid="tiptap-toolbar"
    >
      {TOOLBAR_ACTIONS.map((action, index) => {
        const Icon = action.icon;
        const active = action.isActive(editor);

        return (
          <Button
            key={action.key}
            type="button"
            variant="ghost"
            size="sm"
            tabIndex={index === 0 ? 0 : -1}
            aria-label={action.label}
            aria-pressed={active}
            className={cn('h-8 w-8 p-0', active && 'bg-surface-muted text-brand-700')}
            onClick={() => action.command(editor)}
            data-testid={`tiptap-toolbar-${action.key}`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </Button>
        );
      })}
    </div>
  );
}
