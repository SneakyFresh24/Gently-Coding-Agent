# CI Governance

## Required Status Checks

Configure branch protection for `main` (or `master`) in GitHub settings and mark these checks as required:

- `quality-and-tests / Install dependencies`
- `quality-and-tests / Compile`
- `quality-and-tests / Lint`
- `quality-and-tests / Run stability unit suites`
- `quality-and-tests / Run resilience release gate`
- `quality-and-tests / Security audit (prod, high+ only)`

## Policy

- Pull requests must be up to date before merge.
- Force pushes should be disabled on protected branches.
- Direct pushes to protected branches should be blocked.