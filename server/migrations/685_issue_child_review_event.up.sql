ALTER TABLE issue_child_event DROP CONSTRAINT issue_child_event_kind_check;
ALTER TABLE issue_child_event ADD CONSTRAINT issue_child_event_kind_check
    CHECK (kind IN ('closed','reopened','attached','detached','restaged','in_review')) NOT VALID;

CREATE FUNCTION record_issue_child_review_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO issue_child_event(workspace_id,parent_id,child_id,kind,source_task_id)
 VALUES(NEW.workspace_id,NEW.parent_issue_id,NEW.id,'in_review',
        NULLIF(current_setting('multica.source_task_id',true),'')::uuid);
 RETURN NULL;
END $$;

CREATE TRIGGER issue_child_review_event_update AFTER UPDATE OF status ON issue FOR EACH ROW
 WHEN (NEW.parent_issue_id IS NOT NULL AND NEW.status = 'in_review' AND OLD.status IS DISTINCT FROM NEW.status)
 EXECUTE FUNCTION record_issue_child_review_event();
