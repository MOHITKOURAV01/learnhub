import React from 'react';
import { buildPageWindow } from '../../lib/catalogQuery';

// There was no page control anywhere in the UI, which is why the catalogue
// stopped at course twelve. The window arithmetic lives in lib/catalogQuery so
// it can be tested without a DOM.

const CatalogPager = ({ pagination, onPageChange, disabled = false }) => {
  const { page, totalPages, hasNextPage, hasPreviousPage } = pagination;

  if (!totalPages || totalPages < 2) return null;

  const pageWindow = buildPageWindow(page, totalPages);

  return (
    <nav className="catalog-pager" aria-label="Course catalog pages">
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

export default CatalogPager;
