DROP TRIGGER issue_child_review_event_update ON issue;
DROP FUNCTION record_issue_child_review_event();

DELETE FROM issue_child_event WHERE kind = 'in_review';
ALTER TABLE issue_child_event DROP CONSTRAINT issue_child_event_kind_check;
ALTER TABLE issue_child_event ADD CONSTRAINT issue_child_event_kind_check
    CHECK (kind IN ('closed','reopened','attached','detached','restaged')) NOT VALID;
