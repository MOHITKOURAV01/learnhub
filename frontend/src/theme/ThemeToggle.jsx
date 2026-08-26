import PropTypes from 'prop-types';

import { describeNextPreference, themeIcon, themeLabel } from '../lib/theme';
import { useTheme } from './themeContext';

// The one control, rendered in both navbars (#97). It used to live two clicks
// deep in a Settings dropdown that only a signed-in user could open.

const ThemeToggle = ({ className, showLabel }) => {
  const { preference, theme, toggleTheme } = useTheme();
  const description = describeNextPreference(preference, theme);

  return (
    <button
      type="button"
      className={`theme-toggle${className ? ` ${className}` : ''}`}
      onClick={toggleTheme}
      title={description}
      aria-label={description}
    >
      <span aria-hidden="true" className="theme-toggle-icon">
        {themeIcon(preference, theme)}
      </span>
      {showLabel ? (
        <span className="theme-toggle-label">{themeLabel(preference)}</span>
      ) : null}
    </button>
  );
};

ThemeToggle.propTypes = {
  className: PropTypes.string,
  showLabel: PropTypes.bool,
};

ThemeToggle.defaultProps = {
  className: '',
  showLabel: true,
};

export default ThemeToggle;
