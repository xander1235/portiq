# Wireframes (Text)

## App Shell
- Top bar: App name, workspace selector, settings
- Left sidebar: Collections, Environments, History
- Main split: Request (top) + Response (bottom)
- Right rail: AI assistant (request + response insights)
- Bottom dock: Console, Tests, Timing

## Screen: Request + Response

[Top Bar]
- Workspace dropdown
- Search (history, collections)
- Settings

[Left Sidebar]
- Collections
- Environments
- History

[Main Panel]
- Request editor (top)
  - Method dropdown + URL bar + Send button
  - Tabs: Params | Headers | Auth | Body | Tests
  - Body editor with JSON/XML toggle

- Response viewer (bottom)
  - Status, latency, size
  - Tabs: Pretty | Raw | XML | Table | Visualize
  - Pretty view shows formatted JSON
  - Table view shows grid + search + sort

[Right Rail: AI]
- Request Builder
  - Prompt: “Describe your request”
  - Button: Generate Request
  - Suggestions list (headers, auth, params)

- Response Intelligence
  - Summary card
  - Debug hints
  - Button: Generate Tests

[Bottom Dock]
- Console
- Tests results
- Timing breakdown

## Table View Details
- Toolbar: Search, Filter, Sort, Derived Fields
- Derived Field Editor: name + expression
- Export menu: CSV | JSON

## Flow: Natural Language Request
1. User types prompt
2. AI returns method, URL, headers, body
3. User reviews, edits, sends

## Flow: Auto‑Test Generation
1. User clicks “Generate Tests”
2. AI suggests tests based on response
3. Tests appear in Tests tab (editable)

## Flow: Response Summaries
1. Response received
2. AI summary + hints appear in right rail
