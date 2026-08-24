import PropTypes from 'prop-types';

import { buildPageWindow } from '../../lib/catalogQuery';

// There was no page control anywhere in the UI, which is why the catalogue
// stopped at course twelve. The window arithmetic lives in lib/catalogQuery so
// it can be tested without a DOM.

// `label` is what the pager announces to a screen reader. It defaults to the
// catalogue because that is where this started, but the control itself is not
// catalogue-specific — the enrolled-courses table uses it too.
const CatalogPager = ({
  pagination,
  onPageChange,
  disabled = false,
  label = 'Course catalog pages',
}) => {
  const { page, totalPages, hasNextPage, hasPreviousPage } = pagination;

  if (!totalPages || totalPages < 2) return null;

  const pageWindow = buildPageWindow(page, totalPages);

  return (
    <nav className="catalog-pager" aria-label={label}>
      <button
        type="button"
        className="catalog-pager-step"
        onClick={() => onPageChange(page - 1)}
        disabled={disabled || !hasPreviousPage}
      >
        ‹ Previous
      </button>

      <ol className="catalog-pager-pages">
        {pageWindow.map((entry, index) =>
          entry === 'gap' ? (
            <li key={`gap-${index}`} className="catalog-pager-gap" aria-hidden="true">
              …
            </li>
          ) : (
            <li key={entry}>
              <button
                type="button"
                className={
                  entry === page
                    ? 'catalog-pager-page is-current'
                    : 'catalog-pager-page'
                }
                onClick={() => onPageChange(entry)}
                disabled={disabled}
                aria-current={entry === page ? 'page' : undefined}
                aria-label={`Page ${entry}`}
              >
                {entry}
              </button>
            </li>
          ),
        )}
      </ol>

      <button
        type="button"
        className="catalog-pager-step"
        onClick={() => onPageChange(page + 1)}
        disabled={disabled || !hasNextPage}
      >
        Next ›
      </button>
    </nav>
  );
};

CatalogPager.propTypes = {
  pagination: PropTypes.shape({
    page: PropTypes.number,
    totalPages: PropTypes.number,
    hasNextPage: PropTypes.bool,
    hasPreviousPage: PropTypes.bool,
  }).isRequired,
  onPageChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  label: PropTypes.string,
};

export default CatalogPager;
