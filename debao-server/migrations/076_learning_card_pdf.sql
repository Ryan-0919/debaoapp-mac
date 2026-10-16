alter table learning_cards drop constraint if exists learning_cards_content_type_check;
alter table learning_cards add constraint learning_cards_content_type_check check (content_type in ('image_gallery', 'html', 'pdf'));
