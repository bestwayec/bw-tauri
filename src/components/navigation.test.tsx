import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import Sidebar, { MobileNavigation } from './Sidebar';

function buttons(node: ReactNode): ReactElement<{ onClick: () => void; children: ReactNode }>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const element = child as ReactElement<{ onClick: () => void; children: ReactNode }>;
    return element.type === 'button' ? [element] : buttons(element.props.children);
  });
}

describe('student exam track navigation', () => {
  it('uses the same destination before Profile and Settings on desktop and mobile', () => {
    const onNavigate = vi.fn();
    const props = { route: 'examTrack' as const, onNavigate };
    const desktop = renderToStaticMarkup(<Sidebar {...props} collapsed={false} onToggle={() => {}} />);
    const mobile = renderToStaticMarkup(<MobileNavigation {...props} />);
    for (const html of [desktop, mobile]) {
      expect(html.indexOf('Exam Track')).toBeGreaterThan(html.indexOf('History'));
      expect(html.indexOf('Exam Track')).toBeLessThan(html.indexOf('Profile'));
      expect(html.indexOf('Exam Track')).toBeLessThan(html.indexOf('Settings'));
      expect(html).toContain('aria-current="page"');
    }
    expect(desktop).toContain('lg:flex');
    expect(mobile).toContain('lg:hidden');
    const desktopButtons = buttons(Sidebar({ ...props, collapsed: false, onToggle() {} }));
    const mobileButtons = buttons(MobileNavigation(props));
    // Shared destination order makes the exam track the fourth action on both surfaces.
    desktopButtons[3].props.onClick();
    mobileButtons[3].props.onClick();
    expect(onNavigate.mock.calls).toEqual([['examTrack'], ['examTrack']]);
  });
  it('keeps the exam-track destination accessible while the desktop sidebar is collapsed', () => {
    const html = renderToStaticMarkup(<Sidebar route="examTrack" collapsed onToggle={() => {}} onNavigate={() => {}} />);
    expect(html).toContain('title="Exam Track — IELTS / Multilevel"');
    expect(html).toContain('aria-current="page"');
  });
});
