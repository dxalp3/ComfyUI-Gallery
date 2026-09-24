"""Validated, pixel-preserving image compositions for the Gallery Image Source node.

The core uses Pillow only, so preview routes and tests do not import PyTorch.
ComfyUI's tensor dependencies are imported only when the node executes.
"""

from dataclasses import dataclass
import hashlib
from io import BytesIO
import json
import math
from pathlib import Path
import re

from PIL import Image, ImageOps


MAX_IMAGES = 32
MAX_PIXELS = 64 * 1024 * 1024
MAX_DIMENSION = 32768
MAX_SOURCE_BYTES = 256 * 1024 * 1024
MAX_MANIFEST_BYTES = 2 * 1024 * 1024
DEFAULT_MANIFEST = json.dumps({"version": 1, "images": [], "layout": "single",
                               "columns": 2, "gap": 0, "background": "#ffffff"})


class ImageSourceError(ValueError):
    """A safe error to show in the gallery or a ComfyUI validation message."""


def file_fingerprint(path):
    stat = path.stat()
    return (stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_ino)


def resolve_input(root, input_name):
    if (not isinstance(input_name, str) or not input_name or len(input_name) > 2048
            or any(value in input_name for value in ("\\", ":", "\x00"))
            or any(part in ("", ".", "..") for part in input_name.split("/"))):
        raise ImageSourceError("Choose an image saved inside ComfyUI's input folder.")
    try:
        base = Path(root).resolve(strict=True)
        path = (base / input_name).resolve(strict=True)
        path.relative_to(base)
        if not path.is_file():
            raise ImageSourceError("The selected input is not a regular image file.")
        return path
    except (OSError, ValueError, RuntimeError):
        raise ImageSourceError("Input image is missing or outside ComfyUI's input folder: " + input_name) from None


def _integer(value, label, low, high):
    if type(value) is not int or not low <= value <= high:
        raise ImageSourceError(f"{label} must be a whole number from {low} to {high}.")
    return value


def parse_manifest(value):
    if isinstance(value, str):
        if len(value.encode("utf-8")) > MAX_MANIFEST_BYTES:
            raise ImageSourceError("Image source settings are too large.")
        try:
            value = json.loads(value)
        except (ValueError, RecursionError):
            raise ImageSourceError("Image source settings must be valid JSON.") from None
    if not isinstance(value, dict) or type(value.get("version")) is not int or value["version"] != 1:
        raise ImageSourceError("Unsupported image source settings version.")
    images = value.get("images")
    if not isinstance(images, list) or not 1 <= len(images) <= MAX_IMAGES:
        raise ImageSourceError(f"Add between 1 and {MAX_IMAGES} images to Gallery Image Source.")
    layout = value.get("layout", "single")
    if layout not in ("single", "horizontal", "vertical", "grid"):
        raise ImageSourceError("Choose a single, horizontal, vertical, or grid layout.")
    result = {"version": 1, "images": [], "layout": layout,
              "columns": _integer(value.get("columns", 2), "Grid columns", 1, MAX_IMAGES),
              "gap": _integer(value.get("gap", 0), "Image gap", 0, 4096),
              "background": value.get("background", "#ffffff")}
    if not isinstance(result["background"], str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", result["background"]):
        raise ImageSourceError("Background must be a color in #rrggbb format.")
    for raw in images:
        if not isinstance(raw, dict):
            raise ImageSourceError("Each source must identify an input image.")
        name = raw.get("input_name")
        if not isinstance(name, str) or not name or len(name) > 2048:
            raise ImageSourceError("Each source must identify an input image.")
        item = {"input_name": name}
        if "title" in raw:
            if not isinstance(raw["title"], str) or len(raw["title"]) > 512:
                raise ImageSourceError("Image titles must be at most 512 characters.")
            item["title"] = raw["title"]
        if raw.get("crop") is not None:
            crop = raw["crop"]
            if not isinstance(crop, dict):
                raise ImageSourceError("Image crop must specify x, y, width, and height.")
            crop = {key: crop.get(key) for key in ("x", "y", "width", "height")}
            if any(type(number) not in (int, float) or not math.isfinite(number) for number in crop.values()):
                raise ImageSourceError("Crop values must be finite numbers between 0 and 1.")
            if (crop["x"] < 0 or crop["y"] < 0 or crop["width"] <= 0 or crop["height"] <= 0
                    or crop["x"] + crop["width"] > 1 + 1e-9
                    or crop["y"] + crop["height"] > 1 + 1e-9):
                raise ImageSourceError("Crop must stay inside the image and have a positive width and height.")
            item["crop"] = crop
        result["images"].append(item)
    return result


def inspect_image(path):
    if path.stat().st_size > MAX_SOURCE_BYTES:
        raise ImageSourceError("An input image exceeds the 256 MiB file limit.")
    try:
        with Image.open(path) as image:
            width, height = image.size
            if image.getexif().get(274) in (5, 6, 7, 8):
                width, height = height, width
            if width * height > MAX_PIXELS or max(width, height) > MAX_DIMENSION:
                raise ImageSourceError("An input image exceeds the 64 megapixel or 32768 pixel side limit.")
            return width, height
    except (OSError, ValueError, Image.DecompressionBombError) as error:
        if isinstance(error, ImageSourceError):
            raise
        raise ImageSourceError("An input image cannot be read by this installation of Pillow.") from None


def crop_box(size, crop=None):
    width, height = size
    if crop is None:
        return (0, 0, width, height)
    # The editor works in normalized coordinates of the EXIF-oriented original.
    left = min(width - 1, round(crop["x"] * width))
    top = min(height - 1, round(crop["y"] * height))
    right = min(width, max(left + 1, round((crop["x"] + crop["width"]) * width)))
    bottom = min(height, max(top + 1, round((crop["y"] + crop["height"]) * height)))
    return (left, top, right, bottom)


@dataclass(frozen=True)
class Source:
    path: Path
    fingerprint: tuple
    crop: tuple
    width: int
    height: int
    x: int = 0
    y: int = 0


@dataclass(frozen=True)
class Composition:
    manifest: dict
    sources: tuple
    width: int
    height: int


def plan_composition(manifest, input_root):
    manifest = parse_manifest(manifest)
    inspected = []
    for item in manifest["images"]:
        path = resolve_input(input_root, item["input_name"])
        before = file_fingerprint(path)
        box = crop_box(inspect_image(path), item.get("crop"))
        if file_fingerprint(path) != before:
            raise ImageSourceError("An input image changed while reading; please retry.")
        inspected.append(Source(path, before, box, box[2] - box[0], box[3] - box[1]))
    layout, gap = manifest["layout"], manifest["gap"]
    sources = inspected[:1] if layout == "single" else inspected
    columns = (len(sources) if layout == "horizontal" else 1 if layout in ("single", "vertical")
               else min(manifest["columns"], len(sources)))
    rows = (len(sources) + columns - 1) // columns
    widths = [max(source.width for index, source in enumerate(sources) if index % columns == col)
              for col in range(columns)]
    heights = [max(source.height for source in sources[row * columns:(row + 1) * columns])
               for row in range(rows)]
    width, height = sum(widths) + gap * (columns - 1), sum(heights) + gap * (rows - 1)
    if max(width, height) > MAX_DIMENSION or width * height > MAX_PIXELS:
        raise ImageSourceError("The composition exceeds 64 megapixels or 32768 pixels on one side. Crop images or use fewer sources.")
    placed = []
    for index, source in enumerate(sources):
        col, row = index % columns, index // columns
        placed.append(Source(source.path, source.fingerprint, source.crop, source.width, source.height,
                             sum(widths[:col]) + gap * col, sum(heights[:row]) + gap * row))
    return Composition(manifest, tuple(placed), width, height)


def render_composition(plan, max_edge=None):
    scale = min(1.0, max_edge / max(plan.width, plan.height)) if max_edge else 1.0
    size = (max(1, round(plan.width * scale)), max(1, round(plan.height * scale)))
    canvas = Image.new("RGBA", size, plan.manifest["background"])
    try:
        for source in plan.sources:
            if file_fingerprint(source.path) != source.fingerprint:
                raise ImageSourceError("An input image changed while reading; please retry.")
            with Image.open(source.path) as image:
                image.seek(0)
                oriented = ImageOps.exif_transpose(image)
                try:
                    cropped = oriented.crop(source.crop)
                    try:
                        rgba = cropped.convert("RGBA")
                    finally:
                        cropped.close()
                finally:
                    oriented.close()
                try:
                    position = (round(source.x * scale), round(source.y * scale))
                    target = (max(1, round((source.x + source.width) * scale) - position[0]),
                              max(1, round((source.y + source.height) * scale) - position[1]))
                    if rgba.size != target:
                        resized = rgba.resize(target, Image.Resampling.LANCZOS)
                        rgba.close()
                        rgba = resized
                    # No alpha mask here: preserve source alpha for the MASK output.
                    canvas.paste(rgba, position)
                finally:
                    rgba.close()
            if file_fingerprint(source.path) != source.fingerprint:
                raise ImageSourceError("An input image changed while reading; please retry.")
        canvas.info.clear()
        return canvas
    except Exception:
        canvas.close()
        raise


def preview_composition(manifest, input_root):
    plan = plan_composition(manifest, input_root)
    image = render_composition(plan, max_edge=1024)
    try:
        output = BytesIO()
        image.save(output, "PNG")
        return output.getvalue(), plan.width, plan.height
    finally:
        image.close()


class GalleryImageSource:
    CATEGORY = "image/gallery"
    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT")
    RETURN_NAMES = ("image", "mask", "width", "height")
    FUNCTION = "compose"
    DESCRIPTION = "Choose local or Hydrus images in Gallery, crop them, and join them without rescaling."

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"sources": ("STRING", {"default": DEFAULT_MANIFEST, "multiline": True})}}

    @staticmethod
    def _input_root():
        import folder_paths
        return folder_paths.get_input_directory()

    @classmethod
    def VALIDATE_INPUTS(cls, sources):
        try:
            plan_composition(sources, cls._input_root())
            return True
        except ImageSourceError as error:
            return str(error)
        except OSError:
            return "An input image is unavailable. Reopen the Gallery Image Source editor."

    @classmethod
    def IS_CHANGED(cls, sources):
        try:
            manifest = parse_manifest(sources)
            files = [(item["input_name"], file_fingerprint(resolve_input(cls._input_root(), item["input_name"])))
                     for item in manifest["images"]]
            return hashlib.sha256(json.dumps([manifest, files], sort_keys=True).encode("utf-8")).hexdigest()
        except (ImageSourceError, OSError):
            return float("nan")

    def compose(self, sources):
        import numpy as np
        import torch
        plan = plan_composition(sources, self._input_root())
        image = render_composition(plan)
        try:
            pixels = np.asarray(image, dtype=np.float32) / 255.0
            rgb = torch.from_numpy(pixels[:, :, :3].copy()).unsqueeze(0)
            mask = torch.from_numpy(1.0 - pixels[:, :, 3]).unsqueeze(0)
            return rgb, mask, plan.width, plan.height
        finally:
            image.close()
