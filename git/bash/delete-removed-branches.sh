#!/bin/bash

# Set the default prefix values
prefixes=()

# Parse command-line arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    -e|--exclude)
      prefixes+=("$2")
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Check if there are any local branches
if [ $(git branch | wc -l) -eq 0 ]; then
  echo "No local branches found."
  exit 0
fi

# Get a list of all local branches
local_branches=($(git branch | awk '{print $NF}'))

# Get a list of all remote branches
remote_branches=($(git branch -r | awk '{print $NF}' | sed 's/origin\///'))

# Loop through all local branches
for branch in "${local_branches[@]}"; do
  # Skip branch if it starts with any of the provided prefixes
  skip=false
  for prefix in "${prefixes[@]}"; do
    if [[ "$branch" =~ ^$prefix.* ]]; then
      skip=true
      break
    fi
  done
  if [ "$skip" = true ]; then
    continue
  fi

  # Check if the branch exists on the remote
  exists=false
  for remote_branch in "${remote_branches[@]}"; do
    if [ "$branch" == "$remote_branch" ]; then
      exists=true
      break
    fi
  done

  # Delete the branch if it doesn't exist on the remote
  if [ "$exists" = false ]; then
    echo "Deleting branch $branch"
    git branch -D "$branch"
  fi
done
