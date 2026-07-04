# Figma MCP Extraction Prompt

```txt
Inspect the approved LocalUp homepage build target in Figma using Figma MCP.

Do not redesign anything.
Do not write marketing copy.
Do not invent new sections.

Extract technical implementation data only:

1. Frame info
- page name
- frame name
- dimensions
- section frames
- major groups

2. Tokens
- colors
- typography
- spacing
- padding
- gaps
- radii
- shadows
- borders
- effects

For each value, classify:
official / candidate / merge / exception / needs-review / ignore

3. Components
Identify repeated patterns:
- buttons
- eyebrow pills
- cards
- chips
- icon badges
- section headers
- service items
- process cards
- pricing cards
- FAQ rows
- footer columns
- visuals

For each pattern, suggest:
- Astro component name
- variants
- props/slots
- priority

4. Assets
List export candidates:
- source node/frame
- recommended format
- recommended size
- text baked in?
- alt text requirement

5. Implementation risks
List technical risks and needs-review items.

Output should be structured markdown.
```
