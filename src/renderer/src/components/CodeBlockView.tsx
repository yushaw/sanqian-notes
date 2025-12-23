import { NodeViewWrapper, NodeViewContent, NodeViewProps } from '@tiptap/react'
import { useState, useCallback, useRef, useEffect } from 'react'
import { lowlight } from './extensions/CodeBlock'
import { useTranslations } from '../i18n'

// Common programming languages with display names
const LANGUAGES = [
  { value: 'plaintext', label: 'Plain Text' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'csharp', label: 'C#' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'swift', label: 'Swift' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'php', label: 'PHP' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'scss', label: 'SCSS' },
  { value: 'json', label: 'JSON' },
  { value: 'xml', label: 'XML' },
  { value: 'yaml', label: 'YAML' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'sql', label: 'SQL' },
  { value: 'shell', label: 'Shell' },
  { value: 'bash', label: 'Bash' },
  { value: 'powershell', label: 'PowerShell' },
  { value: 'dockerfile', label: 'Dockerfile' },
  { value: 'graphql', label: 'GraphQL' },
  { value: 'r', label: 'R' },
  { value: 'matlab', label: 'MATLAB' },
  { value: 'latex', label: 'LaTeX' },
]

interface CodeBlockAttrs {
  language: string
}

export function CodeBlockView({ node, updateAttributes }: NodeViewProps) {
  const attrs = node.attrs as CodeBlockAttrs
  const [showDropdown, setShowDropdown] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [copied, setCopied] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const t = useTranslations()

  // Get all registered languages from lowlight
  const registeredLanguages = lowlight.listLanguages()

  // Filter languages based on search and availability
  const filteredLanguages = LANGUAGES.filter(lang => {
    const matchesSearch = lang.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         lang.value.toLowerCase().includes(searchQuery.toLowerCase())
    const isRegistered = registeredLanguages.includes(lang.value) || lang.value === 'plaintext'
    return matchesSearch && isRegistered
  })

  // Get current language display name
  const currentLanguage = LANGUAGES.find(l => l.value === attrs.language)?.label ||
                         attrs.language ||
                         'Plain Text'

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
        setSearchQuery('')
      }
    }

    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      // Focus search input when dropdown opens
      setTimeout(() => searchInputRef.current?.focus(), 0)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showDropdown])

  const handleLanguageSelect = useCallback((language: string) => {
    updateAttributes({ language })
    setShowDropdown(false)
    setSearchQuery('')
  }, [updateAttributes])

  const handleCopy = useCallback(async () => {
    const code = node.textContent
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [node.textContent])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setShowDropdown(false)
      setSearchQuery('')
    } else if (e.key === 'Enter' && filteredLanguages.length > 0) {
      e.preventDefault()
      handleLanguageSelect(filteredLanguages[0].value)
    }
  }, [filteredLanguages, handleLanguageSelect])

  return (
    <NodeViewWrapper className="code-block-wrapper">
      <div className="code-block-header">
        {/* Language Selector - 放在 Copy 按钮左边 */}
        <div className="code-block-language" ref={dropdownRef}>
          <button
            className="code-block-language-btn"
            onClick={() => setShowDropdown(!showDropdown)}
            type="button"
          >
            {currentLanguage}
            <span className="code-block-language-arrow">▾</span>
          </button>

          {showDropdown && (
            <div className="code-block-dropdown">
              <input
                ref={searchInputRef}
                type="text"
                className="code-block-search"
                placeholder={t.codeBlock.searchPlaceholder}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <div className="code-block-language-list">
                {filteredLanguages.map(lang => (
                  <button
                    key={lang.value}
                    className={`code-block-language-option ${lang.value === attrs.language ? 'active' : ''}`}
                    onClick={() => handleLanguageSelect(lang.value)}
                    type="button"
                  >
                    {lang.label}
                  </button>
                ))}
                {filteredLanguages.length === 0 && (
                  <div className="code-block-no-results">
                    {t.codeBlock.noMatch}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Copy Button */}
        <button
          className="code-block-copy-btn"
          onClick={handleCopy}
          type="button"
          title={t.codeBlock.copyCode}
        >
          {copied ? (
            <>
              <span className="code-block-copy-icon">✓</span>
              {t.codeBlock.copied}
            </>
          ) : (
            <>
              <span className="code-block-copy-icon">⎘</span>
              {t.codeBlock.copy}
            </>
          )}
        </button>
      </div>

      <pre>
        <NodeViewContent<"code"> as="code" />
      </pre>
    </NodeViewWrapper>
  )
}
