-- Trigger to keep denormalized rating/reviews_count on listings in sync
-- Fires AFTER INSERT, UPDATE, DELETE on reviews

CREATE OR REPLACE FUNCTION update_listing_rating()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE listings SET
      rating = COALESCE((SELECT AVG(rating) FROM reviews WHERE listing_id = OLD.listing_id), 0),
      reviews_count = (SELECT COUNT(*) FROM reviews WHERE listing_id = OLD.listing_id)
    WHERE id = OLD.listing_id;
    RETURN OLD;
  ELSE
    UPDATE listings SET
      rating = COALESCE((SELECT AVG(rating) FROM reviews WHERE listing_id = NEW.listing_id), 0),
      reviews_count = (SELECT COUNT(*) FROM reviews WHERE listing_id = NEW.listing_id)
    WHERE id = NEW.listing_id;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_review_change ON reviews;

CREATE TRIGGER on_review_change
  AFTER INSERT OR UPDATE OR DELETE ON reviews
  FOR EACH ROW
  EXECUTE FUNCTION update_listing_rating();
