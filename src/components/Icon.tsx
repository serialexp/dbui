// ABOUTME: Simple wrapper component for Phosphor icons from @phosphor-icons/core.
// ABOUTME: Renders SVG icons with configurable size by scaling the container.

interface IconProps {
  svg: string;
  size?: number;
}

export function Icon(props: IconProps) {
  const size = props.size ?? 16;

  // Scale the SVG by wrapping it in a sized container
  const scaledSvg = props.svg.replace(
    /<svg/,
    `<svg width="${size}" height="${size}"`
  );

  return (
    <span
      style={{
        display: "inline-flex",
        "align-items": "center",
        "justify-content": "center",
      }}
      innerHTML={scaledSvg}
    />
  );
}
