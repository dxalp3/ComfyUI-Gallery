# Offline Danbooru tag vocabulary

`danbooru.csv.gz` is a pinned snapshot of the public tag-name/alias dictionary
from [SD WebUI Tag Autocomplete](https://github.com/DominikDoom/a1111-sd-webui-tagcomplete).
The source revision, original SHA-256 and row count are in `danbooru-source.json`;
its license is included in `TAGCOMPLETE-LICENSE.txt`.

This is a vocabulary snapshot, not a claim to contain every current Danbooru tag.
Only canonical names and aliases in general/artist/copyright/character categories
are used. Meta categories and explicit generation-quality terms are excluded.
Matching normalizes spaces/underscores and common numeric prompt weights, but
never guesses tags from arbitrary prose. Frequency values in this file are not
Hydrus database counts; Hydrus autocomplete gets counts from the user's API.

`danbooru-groups.json` contains factual tag names and group membership extracted
from the public [Danbooru wiki tag-group index](https://danbooru.donmai.us/wiki_pages/tag_groups)
through its Safebooru API mirror on 2026-10-04. Each group includes its source URL
and wiki modification timestamp. No wiki prose or images are included. Membership
uses direct linked vocabulary on each page; groups overlap and uncategorized tags
remain searchable. Refresh explicitly with `tools/update_tag_groups.py`; normal
Gallery use never downloads wiki pages or sends prompts to Danbooru.
