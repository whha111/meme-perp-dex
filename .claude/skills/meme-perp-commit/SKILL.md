---
name: meme-perp-commit
description: Create semantic git commits for meme-perp-dex project. Use when user wants to commit changes, save work, or create git commits. Analyzes changed files, groups them logically, and creates well-structured commits following project conventions.
tools: Bash, Read, Grep
---

# Meme Perp DEX - Smart Commit Skill

Automatically create semantic, well-structured git commits for the meme-perp-dex project.

## When to Use

Use this skill when:
- User asks to "commit", "save changes", "create a commit"
- Completing a feature or task
- Need to save work progress
- Before switching branches

## Workflow

### 1. Check Status
```bash
git status --short
```

### 2. Analyze Changes

Group files by category:
- **Backend/Matching**: `backend/src/matching/`
- **Contracts**: `contracts/src/`, `contracts/test/`
- **Frontend**: `frontend/src/`
- **Config**: Root config files

### 3. Create Semantic Commits

Follow conventional commits format:
```
<type>(<scope>): <description>

<body>

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code refactoring
- `test`: Adding tests
- `docs`: Documentation
- `chore`: Maintenance
- `perf`: Performance improvement

**Scopes** (meme-perp-dex specific):
- `auth`: Authentication system
- `relay`: Relay service
- `fomo`: FOMO/Leaderboard
- `metadata`: Token metadata
- `matching`: Order matching engine
- `contracts`: Smart contracts
- `frontend`: Frontend components
- `api`: API endpoints

### 4. Commit Strategy

**Single Logical Change**: One commit per feature/fix
```bash
git add <files>
git commit -m "..."
```

**Multiple Changes**: Separate commits for each logical group
```bash
# Commit 1: Backend
git add backend/src/matching/modules/auth.ts
git commit -m "feat(auth): add authentication module"

# Commit 2: Tests
git add backend/src/matching/test-auth.ts
git commit -m "test(auth): add authentication tests"

# Commit 3: API
git add backend/src/matching/server.ts
git commit -m "feat(api): add auth API endpoints"
```

## Examples

### Example 1: New Feature
```
feat(relay): implement gasless transaction service

- Add relay.ts module with EIP-712 support
- Implement depositETHFor and withdrawFor handlers
- Add nonce and balance query endpoints
- Include relayer balance checks

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

### Example 2: Bug Fix
```
fix(matching): correct order nonce validation

- Remove strict nonce sequence requirement
- Allow chain-synced nonce values
- Fix edge case in nonce comparison

Fixes issue where valid orders were rejected

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

### Example 3: Multiple Files
```
feat(fomo): add leaderboard API endpoints

Backend changes:
- Add FOMO event handlers in server.ts
- Implement ranking serialization
- Add trader stats endpoint

Test coverage:
- test-fomo.ts with 8 test cases

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

## Best Practices

1. **Always check status first**: `git status` to see what changed
2. **Read modified files**: Understand what actually changed
3. **Group related changes**: Don't mix unrelated changes
4. **Write clear messages**: Describe WHY, not just WHAT
5. **Include Co-Authored-By**: Always add Claude attribution
6. **Use HEREDOC for multi-line**: Prevents escaping issues

## HEREDOC Template

```bash
git commit -m "$(cat <<'EOF'
<type>(<scope>): <description>

<body>

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

## Project-Specific Guidelines

### Backend (Matching Engine)
- Scope: `matching`, `auth`, `relay`, `fomo`, `metadata`
- Include line count for new modules
- Mention if API endpoints added

### Contracts
- Scope: `contracts`, `settlement`, `vault`, `factory`
- Note if tests updated
- Mention deployment impact

### Frontend
- Scope: `ui`, `hooks`, `components`, `api-client`
- Mention user-facing changes
- Note mobile/desktop differences

### Configuration
- Scope: `config`, `env`, `docker`
- List breaking changes
- Migration steps if needed

## Output Format

After creating commits, show:
```
✅ Created N commits:

1. abc123f feat(auth): implement authentication system
2. def456a test(auth): add auth test suite
3. ghi789b feat(api): add auth API routes

Total changes: +XXX -YYY lines
```

## Error Handling

If commit fails:
1. Check for pre-commit hooks
2. Verify files are staged
3. Check for conflicts
4. Ensure valid git state

## Notes

- Never use `--no-verify` unless explicitly requested
- Never force commits
- Always validate changes make sense together
- Ask user if unsure about grouping
