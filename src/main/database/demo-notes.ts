import { v4 as uuidv4 } from 'uuid'
import { getDb } from './connection'
import { getSystemLang } from '../i18n'

function getSystemLanguage(): 'zh' | 'en' {
  return getSystemLang()
}

export function createDemoNotes(): void {
  const db = getDb()
  const now = new Date().toISOString()
  const lang = getSystemLanguage()
  const isZh = lang === 'zh'

  const note1Id = uuidv4()
  const note2Id = uuidv4()
  const note3Id = uuidv4()

  const t = {
    note1Title: isZh ? '\u6b22\u8fce\u4f7f\u7528\u5fc3\u6d41' : 'Welcome to Flow',
    note2Title: isZh ? '\u7f16\u8f91\u5668\u529f\u80fd\u6f14\u793a' : 'Editor Features Demo',
    note3Title: isZh ? '\u5feb\u6377\u952e\u901f\u67e5\u8868' : 'Keyboard Shortcuts',
    intro1: isZh ? '\u8fd9\u662f\u4e00\u6b3e\u4e13\u6ce8\u4e8e ' : 'A note-taking app focused on ',
    introHighlight: isZh ? '\u6c89\u6d78\u5f0f\u5199\u4f5c' : 'immersive writing',
    intro2: isZh ? ' \u7684\u7b14\u8bb0\u5e94\u7528\u3002\u67e5\u770b ' : '. Check out ',
    intro3: isZh ? ' \u4e86\u89e3\u9ad8\u7ea7\u529f\u80fd\uff0c\u6216\u9605\u8bfb ' : ' for advanced features, or read ',
    intro4: isZh ? ' \u63d0\u9ad8\u6548\u7387\u3002' : ' to boost productivity.',
    tipText1: isZh ? '\u8f93\u5165 ' : 'Type ',
    tipText2: isZh ? ' \u53ef\u4ee5\u5feb\u901f\u63d2\u5165\u5404\u79cd\u5757\u5143\u7d20\uff0c\u8bd5\u8bd5\u770b\uff01' : ' to quickly insert various blocks. Try it!',
    richFormat: isZh ? '\u4e30\u5bcc\u7684\u6587\u672c\u683c\u5f0f' : 'Rich Text Formatting',
    bold: isZh ? '\u7c97\u4f53' : 'Bold',
    italic: isZh ? '\u659c\u4f53' : 'Italic',
    underline: isZh ? '\u4e0b\u5212\u7ebf' : 'Underline',
    strike: isZh ? '\u5220\u9664\u7ebf' : 'Strikethrough',
    highlight: isZh ? '\u9ad8\u4eae' : 'Highlight',
    colorText: isZh ? '\u5f69\u8272\u6587\u5b57' : 'Colored text',
    inlineCode: isZh ? '\u884c\u5185\u4ee3\u7801' : 'Inline code',
    sep: isZh ? '\u3001' : ', ',
    footnoteInput: isZh ? '\u8f93\u5165 ' : 'Type ',
    footnoteOr: isZh ? ' \u6216\u6309 ' : ' or press ',
    footnoteInsert: isZh ? ' \u63d2\u5165\u811a\u6ce8' : ' to insert a footnote',
    footnoteContent: isZh ? '\u811a\u6ce8\u53ef\u4ee5\u6dfb\u52a0\u8865\u5145\u8bf4\u660e\uff0c\u9f20\u6807\u60ac\u505c\u67e5\u770b\uff0c\u70b9\u51fb\u53ef\u7f16\u8f91\u3002' : 'Footnotes add supplementary info. Hover to view, click to edit.',
    footnoteEnd: isZh ? '\uff0c\u975e\u5e38\u9002\u5408\u5b66\u672f\u5199\u4f5c\u3002' : ', perfect for academic writing.',
    bilink: isZh ? '\u53cc\u5411\u94fe\u63a5' : 'Bi-directional Links',
    bilinkIntro1: isZh ? '\u8f93\u5165 ' : 'Type ',
    bilinkIntro2: isZh ? ' \u53ef\u4ee5\u521b\u5efa\u7b14\u8bb0\u95f4\u7684\u94fe\u63a5\uff0c\u6784\u5efa\u4f60\u7684\u77e5\u8bc6\u7f51\u7edc\uff1a' : ' to create links between notes and build your knowledge network:',
    bilinkNote: isZh ? '[[\u7b14\u8bb0\u540d]]' : '[[Note Name]]',
    bilinkNoteDesc: isZh ? ' \u2014 \u94fe\u63a5\u5230\u7b14\u8bb0' : ' \u2014 Link to a note',
    bilinkHeading: isZh ? '[[\u7b14\u8bb0\u540d#\u6807\u9898]]' : '[[Note Name#Heading]]',
    bilinkHeadingDesc: isZh ? ' \u2014 \u94fe\u63a5\u5230\u7279\u5b9a\u6807\u9898' : ' \u2014 Link to a specific heading',
    bilinkBlock: isZh ? '[[\u7b14\u8bb0\u540d#^blockId]]' : '[[Note Name#^blockId]]',
    bilinkBlockDesc: isZh ? ' \u2014 \u94fe\u63a5\u5230\u7279\u5b9a\u6bb5\u843d' : ' \u2014 Link to a specific paragraph',
    typewriter: isZh ? '\u6253\u5b57\u673a\u6a21\u5f0f' : 'Typewriter Mode',
    twIntro1: isZh ? '\u70b9\u51fb\u5de5\u5177\u680f\u7684\u6253\u5b57\u673a\u56fe\u6807\u8fdb\u5165 ' : 'Click the typewriter icon to enter ',
    twIntro2: isZh ? '\u6c89\u6d78\u5f0f\u5199\u4f5c\u6a21\u5f0f' : 'immersive writing mode',
    twIntro3: isZh ? '\uff1a' : ':',
    twFeature1: isZh ? '\u5149\u6807\u56fa\u5b9a\u5728\u5c4f\u5e55\u4e2d\u592e\uff0c\u5185\u5bb9\u968f\u8f93\u5165\u6eda\u52a8' : 'Cursor stays centered, content scrolls as you type',
    twFeature2: isZh ? '\u4e13\u6ce8\u6a21\u5f0f\u8ba9\u5f53\u524d\u6bb5\u843d\u6e05\u6670\uff0c\u5468\u56f4\u9010\u6e10\u6de1\u51fa' : 'Focus mode keeps current paragraph clear, surroundings fade',
    twFeature3: isZh ? '\u81ea\u52a8\u8ddf\u968f\u7cfb\u7edf\u6df1\u8272/\u6d45\u8272\u4e3b\u9898' : 'Auto-follows system dark/light theme',
    twFeature4: isZh ? '\u5bbd\u5c4f\u65f6\u53f3\u4fa7\u663e\u793a\u5927\u7eb2\u5bfc\u822a' : 'Outline navigation on the right for wide screens',
    task1: isZh ? '\u9605\u8bfb\u672c\u6307\u5357' : 'Read this guide',
    task2: isZh ? '\u5c1d\u8bd5\u8f93\u5165 / \u63d2\u5165\u5757' : 'Try typing / to insert blocks',
    task3: isZh ? '\u4f53\u9a8c\u6253\u5b57\u673a\u6a21\u5f0f' : 'Try typewriter mode',
    task4: isZh ? '\u521b\u5efa\u4f60\u7684\u7b2c\u4e00\u7bc7\u7b14\u8bb0' : 'Create your first note',
  }

  const mainContent = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { blockId: 'intro01' },
        content: [
          { type: 'text', text: t.intro1 },
          { type: 'text', marks: [{ type: 'highlight' }], text: t.introHighlight },
          { type: 'text', text: t.intro2 },
          {
            type: 'text',
            marks: [{ type: 'noteLink', attrs: { noteId: note2Id, noteTitle: t.note2Title } }],
            text: t.note2Title
          },
          { type: 'text', text: t.intro3 },
          {
            type: 'text',
            marks: [{ type: 'noteLink', attrs: { noteId: note3Id, noteTitle: t.note3Title } }],
            text: t.note3Title
          },
          { type: 'text', text: t.intro4 }
        ]
      },
      {
        type: 'callout',
        attrs: { type: 'tip', collapsed: false },
        content: [
          {
            type: 'paragraph', content: [
              { type: 'text', text: t.tipText1 },
              { type: 'text', marks: [{ type: 'code' }], text: '/' },
              { type: 'text', text: t.tipText2 }
            ]
          }
        ]
      },
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'format1' },
        content: [{ type: 'text', text: t.richFormat }]
      },
      {
        type: 'paragraph',
        attrs: { blockId: 'format2' },
        content: [
          { type: 'text', marks: [{ type: 'bold' }], text: t.bold },
          { type: 'text', text: t.sep },
          { type: 'text', marks: [{ type: 'italic' }], text: t.italic },
          { type: 'text', text: t.sep },
          { type: 'text', marks: [{ type: 'underline' }], text: t.underline },
          { type: 'text', text: t.sep },
          { type: 'text', marks: [{ type: 'strike' }], text: t.strike },
          { type: 'text', text: t.sep },
          { type: 'text', marks: [{ type: 'highlight' }], text: t.highlight },
          { type: 'text', text: t.sep },
          { type: 'text', marks: [{ type: 'textStyle', attrs: { color: '#ef4444' } }], text: t.colorText },
          { type: 'text', text: t.sep },
          { type: 'text', marks: [{ type: 'code' }], text: t.inlineCode }
        ]
      },
      {
        type: 'paragraph',
        attrs: { blockId: 'footnote1' },
        content: [
          { type: 'text', text: t.footnoteInput },
          { type: 'text', marks: [{ type: 'code' }], text: isZh ? '/\u811a\u6ce8' : '/footnote' },
          { type: 'text', text: t.footnoteOr },
          { type: 'text', marks: [{ type: 'code' }], text: '\u2318\u21e7F' },
          { type: 'text', text: t.footnoteInsert },
          { type: 'footnote', attrs: { id: 1, content: t.footnoteContent } },
          { type: 'text', text: t.footnoteEnd }
        ]
      },
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'bilink1' },
        content: [{ type: 'text', text: t.bilink }]
      },
      {
        type: 'paragraph',
        attrs: { blockId: 'bilink2' },
        content: [
          { type: 'text', text: t.bilinkIntro1 },
          { type: 'text', marks: [{ type: 'code' }], text: '[[' },
          { type: 'text', text: t.bilinkIntro2 }
        ]
      },
      {
        type: 'bulletList',
        attrs: { blockId: 'bilink3' },
        content: [
          {
            type: 'listItem', content: [{
              type: 'paragraph', content: [
                { type: 'text', marks: [{ type: 'code' }], text: t.bilinkNote },
                { type: 'text', text: t.bilinkNoteDesc }
              ]
            }]
          },
          {
            type: 'listItem', content: [{
              type: 'paragraph', content: [
                { type: 'text', marks: [{ type: 'code' }], text: t.bilinkHeading },
                { type: 'text', text: t.bilinkHeadingDesc }
              ]
            }]
          },
          {
            type: 'listItem', content: [{
              type: 'paragraph', content: [
                { type: 'text', marks: [{ type: 'code' }], text: t.bilinkBlock },
                { type: 'text', text: t.bilinkBlockDesc }
              ]
            }]
          }
        ]
      },
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'typewriter' },
        content: [{ type: 'text', text: t.typewriter }]
      },
      {
        type: 'paragraph',
        attrs: { blockId: 'tw1' },
        content: [
          { type: 'text', text: t.twIntro1 },
          { type: 'text', marks: [{ type: 'bold' }], text: t.twIntro2 },
          { type: 'text', text: t.twIntro3 }
        ]
      },
      {
        type: 'bulletList',
        attrs: { blockId: 'tw2' },
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: t.twFeature1 }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: t.twFeature2 }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: t.twFeature3 }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: t.twFeature4 }] }] }
        ]
      },
      {
        type: 'taskList',
        attrs: { blockId: 'tasks1' },
        content: [
          { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: t.task1 }] }] },
          { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: t.task2 }] }] },
          { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: t.task3 }] }] },
          { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: t.task4 }] }] }
        ]
      }
    ]
  }

  // Features content - Chinese
  const featuresContentZh = {
    type: 'doc',
    content: [
      {
        type: 'paragraph', attrs: { blockId: 'fback1' }, content: [
          { type: 'text', text: '\u8fd4\u56de ' },
          { type: 'text', marks: [{ type: 'noteLink', attrs: { noteId: note1Id, noteTitle: t.note1Title } }], text: t.note1Title }
        ]
      },
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'blockquote' },
        content: [{ type: 'text', text: '\u5f15\u7528\u5757' }]
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '\u8f93\u5165 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '> \u7a7a\u683c' },
          { type: 'text', text: ' \u6216 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/\u5f15\u7528' },
          { type: 'text', text: ' \u521b\u5efa\u5f15\u7528\u5757\uff1a' }
        ]
      },
      {
        type: 'blockquote',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '\u597d\u7684\u7b14\u8bb0\u4e0d\u662f\u8bb0\u5f55\u4e00\u5207\uff0c\u800c\u662f\u8bb0\u5f55\u80fd\u5f15\u53d1\u601d\u8003\u7684\u5185\u5bb9\u3002' }] }
        ]
      },
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'callouts' },
        content: [{ type: 'text', text: '\u63d0\u793a\u5757 Callout' }]
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '\u8f93\u5165 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/callout' },
          { type: 'text', text: ' \u6216 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/\u63d0\u793a' },
          { type: 'text', text: ' \u9009\u62e9\u4e0d\u540c\u7c7b\u578b\uff1a' }
        ]
      },
      {
        type: 'callout', attrs: { type: 'note', collapsed: false }, content: [
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Note' }, { type: 'text', text: '\uff1a\u666e\u901a\u63d0\u793a\u4fe1\u606f' }] }
        ]
      },
      {
        type: 'callout', attrs: { type: 'tip', collapsed: false }, content: [
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Tip' }, { type: 'text', text: '\uff1a\u5b9e\u7528\u6280\u5de7' }] }
        ]
      },
      {
        type: 'callout', attrs: { type: 'warning', collapsed: false }, content: [
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Warning' }, { type: 'text', text: '\uff1a\u6ce8\u610f\u4e8b\u9879' }] }
        ]
      },
      {
        type: 'callout', attrs: { type: 'danger', collapsed: false }, content: [
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Danger' }, { type: 'text', text: '\uff1a\u5371\u9669\u8b66\u544a' }] }
        ]
      },
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'toggle' },
        content: [{ type: 'text', text: '\u6298\u53e0\u5757 Toggle' }]
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '\u8f93\u5165 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/toggle' },
          { type: 'text', text: ' \u6216 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/\u6298\u53e0' },
          { type: 'text', text: ' \u521b\u5efa\u53ef\u5c55\u5f00/\u6536\u8d77\u7684\u5185\u5bb9\uff1a' }
        ]
      },
      {
        type: 'toggle', attrs: { summary: '\u70b9\u51fb\u5c55\u5f00\u67e5\u770b\u8be6\u60c5', collapsed: true }, content: [
          { type: 'paragraph', content: [{ type: 'text', text: '\u6298\u53e0\u5757\u53ef\u4ee5\u9690\u85cf\u957f\u5185\u5bb9\uff0c\u4fdd\u6301\u7b14\u8bb0\u6574\u6d01\u3002' }] },
          {
            type: 'bulletList', content: [
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u9002\u5408\u8be6\u7ec6\u8bf4\u660e' }] }] },
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u9002\u5408 FAQ \u5e38\u89c1\u95ee\u9898' }] }] },
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u9002\u5408\u4ee3\u7801\u793a\u4f8b' }] }] }
            ]
          }
        ]
      },
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'codblk' },
        content: [{ type: 'text', text: '\u4ee3\u7801\u5757' }]
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '\u8f93\u5165 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '```' },
          { type: 'text', text: ' \u6216 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/\u4ee3\u7801' },
          { type: 'text', text: ' \u521b\u5efa\u4ee3\u7801\u5757\uff0c\u70b9\u51fb\u5de6\u4e0a\u89d2\u5207\u6362\u8bed\u8a00\uff1a' }
        ]
      },
      {
        type: 'codeBlock',
        attrs: { language: 'javascript', blockId: 'codex1' },
        content: [{ type: 'text', text: '// \u652f\u6301 100+ \u79cd\u8bed\u8a00\u8bed\u6cd5\u9ad8\u4eae\nfunction greet(name) {\n  console.log(`Hello, ${name}!`);\n}\n\ngreet("\u5fc3\u6d41\u7b14\u8bb0");' }]
      },
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'math' },
        content: [{ type: 'text', text: '\u6570\u5b66\u516c\u5f0f' }]
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '\u884c\u5185\u516c\u5f0f\uff1a\u8f93\u5165 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '$\u516c\u5f0f$' },
          { type: 'text', text: '\uff0c\u5982 ' },
          { type: 'inlineMath', attrs: { latex: 'E = mc^2' } },
          { type: 'text', text: '\u3001' },
          { type: 'inlineMath', attrs: { latex: '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}' } }
        ]
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '\u5757\u7ea7\u516c\u5f0f\uff1a\u8f93\u5165 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/\u6570\u5b66' },
          { type: 'text', text: ' \u6216 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/math' },
          { type: 'text', text: ' \u63d2\u5165\u72ec\u7acb\u516c\u5f0f\u5757\u3002' }
        ]
      },
      {
        type: 'mathematics',
        attrs: { latex: '\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}' }
      },
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'tblsec' },
        content: [{ type: 'text', text: '\u8868\u683c' }]
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '\u8f93\u5165 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/\u8868\u683c' },
          { type: 'text', text: ' \u6216 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/table' },
          { type: 'text', text: ' \u63d2\u5165\u8868\u683c\uff0c\u652f\u6301\u62d6\u62fd\u8c03\u6574\u5217\u5bbd\uff1a' }
        ]
      },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u529f\u80fd' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u5feb\u6377\u8f93\u5165' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u8bf4\u660e' }] }] }
            ]
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u5f15\u7528\u5757' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '> \u7a7a\u683c' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u5f15\u7528\u6587\u5b57' }] }] }
            ]
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u63d0\u793a\u5757' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '/callout' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '4 \u79cd\u7c7b\u578b' }] }] }
            ]
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u6298\u53e0\u5757' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '/toggle' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u5c55\u5f00/\u6536\u8d77' }] }] }
            ]
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u4ee3\u7801\u5757' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '```' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u8bed\u6cd5\u9ad8\u4eae' }] }] }
            ]
          }
        ]
      },
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'imgdemo' },
        content: [{ type: 'text', text: '\u56fe\u7247' }]
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '\u76f4\u63a5\u7c98\u8d34\u56fe\u7247\u6216\u62d6\u62fd\u6587\u4ef6\u5230\u7f16\u8f91\u5668\uff0c\u56fe\u7247\u4f1a\u81ea\u52a8\u4fdd\u5b58\u5230\u672c\u5730\u9644\u4ef6\u76ee\u5f55\uff0c\u652f\u6301\u8c03\u6574\u5927\u5c0f\u548c\u5bf9\u9f50\u65b9\u5f0f\u3002' }]
      },
      { type: 'callout', attrs: { type: 'tip', collapsed: false }, content: [
        { type: 'paragraph', content: [{ type: 'text', text: '\u8bd5\u8bd5\u7c98\u8d34\u4e00\u5f20\u56fe\u7247\u5230\u8fd9\u91cc\uff0c\u6216\u4ece\u6587\u4ef6\u5939\u62d6\u62fd\u56fe\u7247\u8fdb\u6765\uff01' }] }
      ] },
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'mermaid' },
        content: [{ type: 'text', text: 'Mermaid \u56fe\u8868' }]
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '\u8f93\u5165 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/mermaid' },
          { type: 'text', text: ' \u6216 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/\u56fe\u8868' },
          { type: 'text', text: ' \u63d2\u5165\u6d41\u7a0b\u56fe\uff0c\u53cc\u51fb\u7f16\u8f91\uff1a' }
        ]
      },
      {
        type: 'mermaid',
        attrs: { code: 'graph LR\n    A[\u60f3\u6cd5] --> B{\u503c\u5f97\u8bb0\u5f55?}\n    B -->|\u662f| C[\u5199\u5165\u7b14\u8bb0]\n    B -->|\u5426| D[\u5ffd\u7565]\n    C --> E[\u5b9a\u671f\u56de\u987e]\n    E --> A' }
      },
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'dataview' },
        content: [{ type: 'text', text: 'Dataview \u6570\u636e\u67e5\u8be2' }]
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '\u8f93\u5165 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/dataview' },
          { type: 'text', text: ' \u6216 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/\u67e5\u8be2' },
          { type: 'text', text: ' \u521b\u5efa\u6570\u636e\u67e5\u8be2\u5757\uff0c\u652f\u6301 LIST \u548c TABLE \u4e24\u79cd\u8f93\u51fa\u683c\u5f0f\uff1a' }
        ]
      },
      { type: 'dataviewBlock', attrs: { code: 'LIST\nFROM ""\nWHERE is_favorite = true\nLIMIT 5', blockId: 'dvblk1' } },
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'transclusion' },
        content: [{ type: 'text', text: '\u5185\u5bb9\u5f15\u7528 Transclusion' }]
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '\u8f93\u5165 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/transclusion' },
          { type: 'text', text: ' \u6216 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/\u5f15\u7528' },
          { type: 'text', text: ' \u5d4c\u5165\u5176\u4ed6\u7b14\u8bb0\u7684\u5185\u5bb9\uff0c\u652f\u6301\u5b9e\u65f6\u540c\u6b65\u66f4\u65b0\u3002' }
        ]
      },
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'embed' },
        content: [{ type: 'text', text: '\u7f51\u9875\u5d4c\u5165 Embed' }]
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '\u8f93\u5165 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/embed' },
          { type: 'text', text: ' \u6216 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/\u5d4c\u5165' },
          { type: 'text', text: ' \u5d4c\u5165\u7f51\u9875\u3001\u89c6\u9891\u7b49\u5916\u90e8\u5185\u5bb9\u3002' }
        ]
      },
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'importexport' },
        content: [{ type: 'text', text: '\u5bfc\u5165\u5bfc\u51fa' }]
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '\u70b9\u51fb\u7f16\u8f91\u5668\u53f3\u4e0a\u89d2\u7684 ' },
          { type: 'text', marks: [{ type: 'bold' }], text: '\u22ef' },
          { type: 'text', text: ' \u83dc\u5355\uff1a' }
        ]
      },
      {
        type: 'bulletList', content: [
          {
            type: 'listItem', content: [{
              type: 'paragraph', content: [
                { type: 'text', marks: [{ type: 'bold' }], text: '\u5bfc\u51fa' },
                { type: 'text', text: '\uff1a\u652f\u6301 PDF \u548c Markdown \u683c\u5f0f' }
              ]
            }]
          },
          {
            type: 'listItem', content: [{
              type: 'paragraph', content: [
                { type: 'text', marks: [{ type: 'bold' }], text: '\u5bfc\u5165' },
                { type: 'text', text: '\uff1a\u652f\u6301 Markdown\u3001PDF \u89e3\u6790\u3001arXiv \u8bba\u6587\u5bfc\u5165' }
              ]
            }]
          }
        ]
      },
      { type: 'horizontalRule' },
      {
        type: 'paragraph', content: [
          { type: 'text', text: '\u67e5\u770b ' },
          { type: 'text', marks: [{ type: 'noteLink', attrs: { noteId: note3Id, noteTitle: t.note3Title } }], text: t.note3Title },
          { type: 'text', text: ' \u4e86\u89e3\u66f4\u591a\u5feb\u6377\u64cd\u4f5c\u3002' }
        ]
      }
    ]
  }

  // Features content - English
  const featuresContentEn = {
    type: 'doc',
    content: [
      {
        type: 'paragraph', attrs: { blockId: 'fback1' }, content: [
          { type: 'text', text: 'Back to ' },
          { type: 'text', marks: [{ type: 'noteLink', attrs: { noteId: note1Id, noteTitle: t.note1Title } }], text: t.note1Title }
        ]
      },
      { type: 'heading', attrs: { level: 1, blockId: 'blockquote' }, content: [{ type: 'text', text: 'Blockquotes' }] },
      {
        type: 'paragraph', content: [
          { type: 'text', text: 'Type ' },
          { type: 'text', marks: [{ type: 'code' }], text: '> space' },
          { type: 'text', text: ' or ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/quote' },
          { type: 'text', text: ' to create a quote block:' }
        ]
      },
      {
        type: 'blockquote', content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Good notes are not about recording everything, but capturing what sparks thinking.' }] }
        ]
      },
      { type: 'heading', attrs: { level: 1, blockId: 'callouts' }, content: [{ type: 'text', text: 'Callout Blocks' }] },
      {
        type: 'paragraph', content: [
          { type: 'text', text: 'Type ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/callout' },
          { type: 'text', text: ' to choose types (note/tip/warning/danger):' }
        ]
      },
      { type: 'callout', attrs: { type: 'note', collapsed: false }, content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Note: Default blue style for general information' }] }
      ] },
      { type: 'callout', attrs: { type: 'tip', collapsed: false }, content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Tip: Green style for helpful suggestions' }] }
      ] },
      { type: 'callout', attrs: { type: 'warning', collapsed: false }, content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Warning: Yellow style for important notices' }] }
      ] },
      { type: 'callout', attrs: { type: 'danger', collapsed: false }, content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Danger: Red style for critical warnings' }] }
      ] },
      { type: 'heading', attrs: { level: 1, blockId: 'toggle' }, content: [{ type: 'text', text: 'Toggle Blocks' }] },
      {
        type: 'paragraph', content: [
          { type: 'text', text: 'Type ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/toggle' },
          { type: 'text', text: ' to create collapsible content:' }
        ]
      },
      {
        type: 'toggle', attrs: { summary: 'Click to expand', collapsed: true }, content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Toggle blocks hide long content, keeping notes tidy.' }] },
          {
            type: 'bulletList', content: [
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Great for detailed explanations' }] }] },
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Perfect for FAQ sections' }] }] },
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ideal for code examples' }] }] }
            ]
          }
        ]
      },
      { type: 'heading', attrs: { level: 1, blockId: 'codblk' }, content: [{ type: 'text', text: 'Code Blocks' }] },
      {
        type: 'paragraph', content: [
          { type: 'text', text: 'Type ' },
          { type: 'text', marks: [{ type: 'code' }], text: '```' },
          { type: 'text', text: ' or ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/code' },
          { type: 'text', text: ' to create a code block:' }
        ]
      },
      { type: 'codeBlock', attrs: { language: 'javascript', blockId: 'codex1' }, content: [{ type: 'text', text: '// Syntax highlighting\nfunction greet(name) {\n  console.log(`Hello, ${name}!`);\n}\n\ngreet("Flow");' }] },
      { type: 'heading', attrs: { level: 1, blockId: 'math' }, content: [{ type: 'text', text: 'Math Formulas' }] },
      {
        type: 'paragraph', content: [
          { type: 'text', text: 'Type ' },
          { type: 'text', marks: [{ type: 'code' }], text: '$formula$' },
          { type: 'text', text: ' for inline math: ' },
          { type: 'inlineMath', attrs: { latex: 'E = mc^2' } },
          { type: 'text', text: ', or type ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/math' },
          { type: 'text', text: ' to insert.' }
        ]
      },
      {
        type: 'paragraph', content: [
          { type: 'text', text: 'More examples: ' },
          { type: 'inlineMath', attrs: { latex: '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}' } },
          { type: 'text', text: ', ' },
          { type: 'inlineMath', attrs: { latex: '\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}' } }
        ]
      },
      { type: 'heading', attrs: { level: 1, blockId: 'tblsec' }, content: [{ type: 'text', text: 'Tables' }] },
      {
        type: 'paragraph', content: [
          { type: 'text', text: 'Type ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/table' },
          { type: 'text', text: ' to insert a table:' }
        ]
      },
      {
        type: 'table', content: [
          {
            type: 'tableRow', content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Feature' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Shortcut' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Description' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Callout' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '/callout' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '4 types' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Toggle' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '/toggle' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Collapsible' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Diagram' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '/mermaid' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Flowcharts' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Footnote' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '/footnote' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u2318\u21e7F' }] }] }
            ]
          }
        ]
      },
      { type: 'heading', attrs: { level: 1, blockId: 'imgdemo' }, content: [{ type: 'text', text: 'Images' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Paste images or drag files into the editor. Images are saved locally. Supports resizing and alignment.' }] },
      { type: 'callout', attrs: { type: 'tip', collapsed: false }, content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Try pasting an image here, or drag one from your file manager!' }] }
      ] },
      { type: 'heading', attrs: { level: 1, blockId: 'mermaid' }, content: [{ type: 'text', text: 'Mermaid Diagrams' }] },
      {
        type: 'paragraph', content: [
          { type: 'text', text: 'Type ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/mermaid' },
          { type: 'text', text: ' to insert a diagram. Double-click to edit:' }
        ]
      },
      { type: 'mermaid', attrs: { code: 'graph LR\n    A[Idea] --> B{Worth noting?}\n    B -->|Yes| C[Write it down]\n    B -->|No| D[Skip]\n    C --> E[Review regularly]\n    E --> A' } },
      { type: 'heading', attrs: { level: 1, blockId: 'dataview' }, content: [{ type: 'text', text: 'Dataview Queries' }] },
      {
        type: 'paragraph', content: [
          { type: 'text', text: 'Type ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/dataview' },
          { type: 'text', text: ' to create data query blocks with LIST and TABLE output:' }
        ]
      },
      { type: 'dataviewBlock', attrs: { code: 'LIST\nFROM ""\nWHERE is_favorite = true\nLIMIT 5', blockId: 'dvblk1' } },
      { type: 'heading', attrs: { level: 1, blockId: 'transclusion' }, content: [{ type: 'text', text: 'Transclusion' }] },
      {
        type: 'paragraph', content: [
          { type: 'text', text: 'Type ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/transclusion' },
          { type: 'text', text: ' to embed content from other notes with live sync.' }
        ]
      },
      { type: 'heading', attrs: { level: 1, blockId: 'embed' }, content: [{ type: 'text', text: 'Web Embeds' }] },
      {
        type: 'paragraph', content: [
          { type: 'text', text: 'Type ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/embed' },
          { type: 'text', text: ' to embed web pages, videos, and external content.' }
        ]
      },
      { type: 'heading', attrs: { level: 1, blockId: 'importexport' }, content: [{ type: 'text', text: 'Import & Export' }] },
      {
        type: 'paragraph', content: [
          { type: 'text', text: 'Click the ' },
          { type: 'text', marks: [{ type: 'bold' }], text: '\u22ef' },
          { type: 'text', text: ' menu in the top-right corner:' }
        ]
      },
      {
        type: 'bulletList', content: [
          {
            type: 'listItem', content: [{
              type: 'paragraph', content: [
                { type: 'text', marks: [{ type: 'bold' }], text: 'Export' },
                { type: 'text', text: ': PDF and Markdown formats' }
              ]
            }]
          },
          {
            type: 'listItem', content: [{
              type: 'paragraph', content: [
                { type: 'text', marks: [{ type: 'bold' }], text: 'Import' },
                { type: 'text', text: ': Markdown, PDF parsing, arXiv papers' }
              ]
            }]
          }
        ]
      },
      { type: 'horizontalRule' },
      {
        type: 'paragraph', content: [
          { type: 'text', text: 'See ' },
          { type: 'text', marks: [{ type: 'noteLink', attrs: { noteId: note3Id, noteTitle: t.note3Title } }], text: t.note3Title },
          { type: 'text', text: ' for more shortcuts.' }
        ]
      }
    ]
  }

  const featuresContent = isZh ? featuresContentZh : featuresContentEn

  // Shortcuts content - Chinese
  const shortcutsContentZh = {
    type: 'doc',
    content: [
      {
        type: 'paragraph', attrs: { blockId: 'scback1' }, content: [
          { type: 'text', text: '\u8fd4\u56de ' },
          { type: 'text', marks: [{ type: 'noteLink', attrs: { noteId: note1Id, noteTitle: t.note1Title } }], text: t.note1Title }
        ]
      },
      {
        type: 'callout', attrs: { type: 'tip', collapsed: false, blockId: 'tip001' }, content: [
          {
            type: 'paragraph', content: [
              { type: 'text', marks: [{ type: 'bold' }], text: '\u63d0\u793a\uff1a' },
              { type: 'text', text: '\u8fd9\u4e2a\u6bb5\u843d\u53ef\u4ee5\u88ab\u5176\u4ed6\u7b14\u8bb0\u5f15\u7528\uff01\u8bed\u6cd5\uff1a' },
              { type: 'text', marks: [{ type: 'code' }], text: `[[${t.note3Title}#^tip001]]` }
            ]
          }
        ]
      },
      { type: 'heading', attrs: { level: 1, blockId: 'txtfmt' }, content: [{ type: 'text', text: '\u6587\u5b57\u683c\u5f0f' }] },
      {
        type: 'table', attrs: { blockId: 'fmttbl' }, content: [
          {
            type: 'tableRow', content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u64cd\u4f5c' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u5feb\u6377\u952e' }] }] }
            ]
          },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u7c97\u4f53' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '\u2318 B' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u659c\u4f53' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '\u2318 I' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u4e0b\u5212\u7ebf' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '\u2318 U' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u5220\u9664\u7ebf' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '\u2318 \u21e7 S' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u9ad8\u4eae' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '\u2318 \u21e7 H' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u884c\u5185\u4ee3\u7801' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '\u2318 E' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u811a\u6ce8' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '\u2318 \u21e7 F' }] }] }
          ] }
        ]
      },
      { type: 'heading', attrs: { level: 1, blockId: 'editop' }, content: [{ type: 'text', text: '\u7f16\u8f91\u64cd\u4f5c' }] },
      {
        type: 'table', attrs: { blockId: 'edttbl' }, content: [
          { type: 'tableRow', content: [
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u64cd\u4f5c' }] }] },
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u5feb\u6377\u952e' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u64a4\u9500' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '\u2318 Z' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u91cd\u505a' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '\u2318 \u21e7 Z' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u4fdd\u5b58' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '\u2318 S' }] }] }
          ] }
        ]
      },
      { type: 'heading', attrs: { level: 1, blockId: 'qkinpt' }, content: [{ type: 'text', text: '\u5feb\u6377\u8f93\u5165' }] },
      {
        type: 'table', content: [
          { type: 'tableRow', content: [
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u8f93\u5165' }] }] },
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u6548\u679c' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '/' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u6253\u5f00\u547d\u4ee4\u83dc\u5355' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '[[' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u63d2\u5165\u7b14\u8bb0\u94fe\u63a5' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '# Space' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u4e00\u7ea7\u6807\u9898' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '- Space' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u65e0\u5e8f\u5217\u8868' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '1. Space' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u6709\u5e8f\u5217\u8868' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '[] Space' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u4efb\u52a1\u5217\u8868' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '> Space' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u5f15\u7528\u5757' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '```' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u4ee3\u7801\u5757' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '---' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u5206\u5272\u7ebf' }] }] }
          ] }
        ]
      },
      { type: 'heading', attrs: { level: 1, blockId: 'navop' }, content: [{ type: 'text', text: '\u5bfc\u822a\u64cd\u4f5c' }] },
      {
        type: 'table', attrs: { blockId: 'navtbl' }, content: [
          { type: 'tableRow', content: [
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u64cd\u4f5c' }] }] },
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u5feb\u6377\u952e' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u65b0\u5efa\u7b14\u8bb0' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '\u2318 N' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u65b0\u5efa\u6807\u7b7e\u9875' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '\u2318 T' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u5173\u95ed\u6807\u7b7e\u9875' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '\u2318 W' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u641c\u7d22\u7b14\u8bb0' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '\u2318 P' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u5168\u5c40\u641c\u7d22' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '\u2318 \u21e7 F' }] }] }
          ] }
        ]
      },
      { type: 'horizontalRule' },
      {
        type: 'paragraph', content: [
          { type: 'text', text: '\u66f4\u591a\u529f\u80fd\u89c1 ' },
          { type: 'text', marks: [{ type: 'noteLink', attrs: { noteId: note2Id, noteTitle: t.note2Title } }], text: t.note2Title }
        ]
      }
    ]
  }

  // Shortcuts content - English
  const shortcutsContentEn = {
    type: 'doc',
    content: [
      {
        type: 'paragraph', attrs: { blockId: 'scback1' }, content: [
          { type: 'text', text: 'Back to ' },
          { type: 'text', marks: [{ type: 'noteLink', attrs: { noteId: note1Id, noteTitle: t.note1Title } }], text: t.note1Title }
        ]
      },
      {
        type: 'callout', attrs: { type: 'tip', collapsed: false, blockId: 'tip001' }, content: [
          {
            type: 'paragraph', content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Tip: ' },
              { type: 'text', text: 'This paragraph can be referenced by other notes! Syntax: ' },
              { type: 'text', marks: [{ type: 'code' }], text: `[[${t.note3Title}#^tip001]]` }
            ]
          }
        ]
      },
      { type: 'heading', attrs: { level: 1, blockId: 'txtfmt' }, content: [{ type: 'text', text: 'Text Formatting' }] },
      {
        type: 'table', attrs: { blockId: 'fmttbl' }, content: [
          { type: 'tableRow', content: [
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Action' }] }] },
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Shortcut' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bold' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '\u2318 B' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Italic' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '\u2318 I' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Underline' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '\u2318 U' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Strikethrough' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '\u2318 \u21e7 S' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Highlight' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '\u2318 \u21e7 H' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Inline Code' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '\u2318 E' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Footnote' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '\u2318 \u21e7 F' }] }] }
          ] }
        ]
      },
      { type: 'heading', attrs: { level: 1, blockId: 'editop' }, content: [{ type: 'text', text: 'Editing' }] },
      {
        type: 'table', attrs: { blockId: 'edttbl' }, content: [
          { type: 'tableRow', content: [
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Action' }] }] },
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Shortcut' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Undo' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '\u2318 Z' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Redo' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '\u2318 \u21e7 Z' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Save' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '\u2318 S' }] }] }
          ] }
        ]
      },
      { type: 'heading', attrs: { level: 1, blockId: 'qkinpt' }, content: [{ type: 'text', text: 'Quick Input' }] },
      {
        type: 'table', content: [
          { type: 'tableRow', content: [
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Input' }] }] },
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Result' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '/' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Open command menu' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '[[' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Insert note link' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '# Space' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Heading 1' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '- Space' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bullet list' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '1. Space' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Numbered list' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '[] Space' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Task list' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '> Space' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Blockquote' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '```' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Code block' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '---' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Divider' }] }] }
          ] }
        ]
      },
      { type: 'heading', attrs: { level: 1, blockId: 'navop' }, content: [{ type: 'text', text: 'Navigation' }] },
      {
        type: 'table', attrs: { blockId: 'navtbl' }, content: [
          { type: 'tableRow', content: [
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Action' }] }] },
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Shortcut' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New note' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '\u2318 N' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New tab' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '\u2318 T' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Close tab' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '\u2318 W' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Search notes' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '\u2318 P' }] }] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Global search' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '\u2318 \u21e7 F' }] }] }
          ] }
        ]
      },
      { type: 'horizontalRule' },
      {
        type: 'paragraph', content: [
          { type: 'text', text: 'See ' },
          { type: 'text', marks: [{ type: 'noteLink', attrs: { noteId: note2Id, noteTitle: t.note2Title } }], text: t.note2Title },
          { type: 'text', text: ' for more features.' }
        ]
      }
    ]
  }

  const shortcutsContent = isZh ? shortcutsContentZh : shortcutsContentEn

  const insertStmt = db.prepare(`
    INSERT INTO notes (id, title, content, notebook_id, is_daily, daily_date, is_favorite, is_pinned, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  insertStmt.run(note1Id, t.note1Title, JSON.stringify(mainContent), null, 0, null, 0, 1, now, now)
  insertStmt.run(note2Id, t.note2Title, JSON.stringify(featuresContent), null, 0, null, 0, 0, now, now)
  insertStmt.run(note3Id, t.note3Title, JSON.stringify(shortcutsContent), null, 0, null, 0, 0, now, now)
}

export function createDemoNote(): void {
  createDemoNotes()
}
