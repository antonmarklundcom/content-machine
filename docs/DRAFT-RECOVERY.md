# Recovering editor drafts

Post and script editors keep unsaved edits in this browser. The draft is
scoped to the signed-in user, brand, document kind and ID. Internal links,
Back and refresh retain the draft; reopening that same editor restores it
with a visible notice. Browser close/reload also warns while the editor is
dirty. Local recovery records expire after seven days.

**Save** still updates the server. Export, generation, approval and
scheduling controls use the saved copy and are blocked while that page has
unsaved editor changes. Validation errors and failed saves retain the local
draft. A slow save does not clear new edits typed while the request was in
flight.

If the server copy changed since the draft began, the recovered edits remain
visible and Save is disabled. Review the changes, then choose **Keep my
edits** to save against the current copy or **Use saved copy** to discard
the recovery. Post saves also compare the server revision; script saves
compare the original body, so a later concurrent edit refuses the write.

If browser storage is unavailable or full, the editor displays a warning.
Save before leaving. Recovery is local to this browser and device; it is not
a backup or a server autosave. Clearing browser storage removes recovery
records. Existing work cannot be recovered if it was lost before this
feature was installed.
