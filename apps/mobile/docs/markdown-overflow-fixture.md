# Mobile Markdown width regression fixture

Paste the content below the divider into an issue description, a root comment,
a reply (including a reply to a reply), and a chat message. Test at 320, 360,
and 412 dp in both themes, with text selection enabled and disabled. Comments
currently flatten descendant replies inside the root bubble; also check an
indented or side-by-side host when reusing the shared renderer.

Prose, headings, links, and inline code must wrap inside the available body
width. Top-level code, wide tables, and display math must expose their last
character through horizontal scrolling inside that width. Nested code uses
the native wrapping fallback so lists/quotes keep their structure. Images must
fit the body width. The HTML width below must not affect native layout.

Drag horizontally in both directions over wide blocks, then start a vertical
drag over each block to scroll the page. Check narrow tables, stationary link
taps, long presses, code copying, image lightbox, keyboard dismissal, rotation,
and a large system font. Short compact chat bubbles should still size to their
content. This fixture is manual coverage; unit tests alone do not verify these
interactions on a device.

---

## Heading_With_An_Unbroken_Identifier_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

Ordinary English and 中文 mixed with **bold**, *italic*, ~~deleted text~~,
`inline_code`, and punctuation.

https://example.com/very/long/path/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef?signature=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

`/workspace/packages/components/long_directory_name_without_breaks_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef/file.tsx`

0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

[@An_author_with_a_very_long_display_name_0123456789abcdef0123456789abcdef](mention://member/11111111-1111-4111-8111-111111111111)

> First quote with `long_inline_code_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`.
>
> > Nested quote with https://example.com/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef/end
> >
> > - [ ] A task nested inside the quote.
> >   - A nested list item with `long_inline_code_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`.

1. Ordered parent
   1. Ordered child
      - [x] Completed task with **bold** and ~~strikethrough~~.
      - [ ] Unchecked task with /a/long/path/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef/end

```typescript
const value = "code start 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 code end";
```

    indented_code_start 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 indented_code_end

- Native nested code fallback:

  ```text
  nested_code_start_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef_nested_code_end
  ```

| First column | Second column | Third column | Fourth column | Fifth column | Last column |
| ------------ | ------------- | ------------ | ------------- | ------------ | ----------- |
| Start A      | Field B       | Field C      | Field D       | Field E      | End F       |
| https://example.com/0123456789abcdef0123456789abcdef0123456789abcdef | `code` | **bold** | 中文 | field | End |

| Narrow | Table |
| ------ | ----- |
| A      | B     |

$$
\frac{a+b+c+d+e+f+g+h+i+j+k+l+m+n+o+p+q+r+s+t+u+v+w+x+y+z}{1+2+3+4+5+6+7+8+9}
$$

<div style="width:9999px">HTML_long_text_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef</div>

<img src="https://placehold.co/1600x400/png" width="9999" height="400" alt="Wide image">

End of the fixture. Add several ordinary paragraphs after this line to give
the outer timeline enough vertical content for gesture testing.
