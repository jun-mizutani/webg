"""Dependency-free SceneYAML reader and source-preserving writer (MIT).

The supported grammar matches webg/SceneYaml.js: block maps/sequences,
single-line flow collections, quoted strings and finite JSON-like scalars.
Offsets refer to Python string characters, not UTF-8 bytes.
"""
import copy
import gzip
import hashlib
import json
import math
import os
import re
import tempfile
import time
from pathlib import Path


def scalar(text):
    """Read the same finite scalar subset as the browser's SceneYAML reader."""
    text = text.strip()
    if text.startswith('"'):
        return json.loads(text)
    if text.startswith("'"):
        if not text.endswith("'"):
            raise ValueError('Unclosed quoted string')
        return text[1:-1].replace("''", "'")
    if text in ('null', '~'):
        return None
    if text in ('true', 'false'):
        return text == 'true'
    if re.fullmatch(r'[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?', text):
        number = float(text)
        if math.isfinite(number):
            return int(number) if number.is_integer() else number
    return text


def outside(text, delimiter):
    """Find unquoted delimiter outside flow collections."""
    quote = None
    depth = 0
    i = 0
    while i < len(text):
        ch = text[i]
        if quote:
            if quote == '"' and ch == '\\':
                i += 2
                continue
            if ch == quote:
                if quote == "'" and text[i:i+2] == "''":
                    i += 2
                    continue
                quote = None
        elif ch in "\"'":
            quote = ch
        elif ch == delimiter and depth == 0:
            if delimiter != '#' or i == 0 or text[i-1].isspace():
                return i
        elif ch in '[{':
            depth += 1
        elif ch in ']}':
            depth -= 1
        i += 1
    return -1


def flow(value):
    """JSON flow syntax is within SceneYAML and quotes ambiguous strings."""
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(', ', ': '))


class Document:
    """Pair parsed values with original source ranges for minimal text patches.

    Comments are retained by preserving the complete source, rather than by
    reconstructing them from parsed values. A value span excludes its trailing
    comment, so changing a number keeps the explanation beside that number.
    """
    def __init__(self, text):
        self.text = text
        self.spans = {}
        self.blocks = {}
        self.items = {}
        self.lines = []
        offset = 0
        for number, raw in enumerate(text.splitlines(keepends=True), 1):
            line = raw.rstrip('\r\n')
            if '\t' in line:
                raise ValueError(f'Line {number}: tabs are not supported')
            bom = 1 if offset == 0 and line.startswith('\ufeff') else 0
            if bom:
                line = line[1:]
            cut = outside(line, '#')
            content = (line if cut < 0 else line[:cut]).rstrip()
            indent = len(content) - len(content.lstrip())
            if content.strip() and content.strip() not in ('---', '...'):
                self.lines.append((indent, content.strip(), offset + bom + indent, number))
            offset += len(raw)
        if self.lines and self.lines[0][0] != 0:
            raise ValueError('Root indentation must be zero')
        if self.lines:
            self.data, end = self.block(0, self.lines[0][0], ())
            if end != len(self.lines):
                raise ValueError(f'Unexpected content at line {self.lines[end][3]}')
        else:
            self.data = None

    def value(self, text, offset, path):
        """Index nested flow values so individual components remain editable."""
        stripped = text.strip()
        offset += len(text) - len(text.lstrip())
        self.spans[path] = (offset, offset + len(stripped))
        if stripped.startswith(('[', '{')):
            close = ']' if stripped[0] == '[' else '}'
            if not stripped.endswith(close):
                raise ValueError('Unclosed flow collection')
            result = [] if close == ']' else {}
            rest = stripped[1:-1]
            start = offset + 1
            while rest.strip():
                split = outside(rest, ',')
                item = rest if split < 0 else rest[:split]
                if isinstance(result, dict):
                    colon = outside(item, ':')
                    if colon < 0:
                        raise ValueError('Flow mapping needs a colon')
                    key = self.key(item[:colon])
                    if key in result:
                        raise ValueError(f'duplicate key: {key}')
                    result[key] = self.value(item[colon+1:], start+colon+1, path+(key,))
                else:
                    result.append(self.value(item, start, path+(len(result),)))
                if split < 0:
                    break
                start += split + 1
                rest = rest[split+1:]
            return result
        return scalar(stripped)

    @staticmethod
    def key(text):
        key = text.strip()
        if not key:
            raise ValueError('Empty key')
        return scalar(key) if key[0] in "\"'" else key

    def block(self, i, indent, path):
        """Parse one indentation level and record its safe append position."""
        seq = self.lines[i][1] == '-' or self.lines[i][1].startswith('- ')
        result = [] if seq else {}
        start_index = i
        while i < len(self.lines) and self.lines[i][0] == indent:
            _, text, offset, number = self.lines[i]
            is_seq = text == '-' or text.startswith('- ')
            if seq != is_seq:
                break
            if seq:
                item_path = path + (len(result),)
                begin = self.text.rfind('\n', 0, offset) + 1
                # Attach contiguous preceding comment lines to this sequence item.
                while begin > 0:
                    previous = self.text.rfind('\n', 0, begin-1) + 1
                    line = self.text[previous:begin].strip()
                    if not line.startswith('#'):
                        break
                    begin = previous
                rest = text[1:].lstrip()
                rest_offset = offset + len(text) - len(rest)
                i += 1
                if not rest:
                    if i < len(self.lines) and self.lines[i][0] > indent:
                        value, i = self.block(i, self.lines[i][0], item_path)
                    else:
                        value = None
                elif outside(rest, ':') >= 0 and not rest.startswith(('{', '[')):
                    # Treat the first mapping entry after '-' as a virtual indented line.
                    virtual = (indent+2, rest, rest_offset, number)
                    self.lines.insert(i, virtual)
                    value, i = self.block(i, indent+2, item_path)
                else:
                    value = self.value(rest, rest_offset, item_path)
                result.append(value)
                last = self.lines[i-1]
                end = self.text.find('\n', last[2]+len(last[1]))
                self.items[item_path] = (begin, len(self.text) if end < 0 else end+1)
            else:
                colon = outside(text, ':')
                if colon < 0 or (colon+1 < len(text) and not text[colon+1].isspace()):
                    raise ValueError(f'Line {number}: expected key: value')
                key = self.key(text[:colon])
                if key in result:
                    raise ValueError(f'Line {number}: duplicate key: {key}')
                rest = text[colon+1:]
                i += 1
                if rest.strip():
                    value = self.value(rest, offset+colon+1, path+(key,))
                elif i < len(self.lines) and self.lines[i][0] > indent:
                    value, i = self.block(i, self.lines[i][0], path+(key,))
                else:
                    value = {}
                    self.spans[path+(key,)] = (offset+len(text), offset+len(text))
                result[key] = value
        if i < len(self.lines) and self.lines[i][0] > indent:
            raise ValueError(f'Unexpected indentation at line {self.lines[i][3]}')
        last = self.lines[i-1]
        end = self.text.find('\n', last[2]+len(last[1]))
        end = len(self.text) if end < 0 else end+1
        self.blocks[path] = (indent, end)
        return result, i

    def update(self, value):
        """Keep unchanged source bytes; patch values and append new keys/items.

        Structural removals/reordering are explicit errors in this first writer.
        This prevents silent loss of the comments attached to deleted elements.
        """
        edits = []
        newline = '\r\n' if '\r\n' in self.text else '\n'

        def walk(old, new, path):
            if old == new:
                return
            # Animation keys and their parallel poses move as one semantic unit.
            # Reuse each item's original text so key/pose comments follow its ID.
            animation_list = path and path[0] == 'animations' and isinstance(old, list) and isinstance(new, list)
            if animation_list and path in self.blocks and old:
                old_ids = [v.get('id') for v in old if isinstance(v, dict)]
                new_ids = [v.get('id') for v in new if isinstance(v, dict)]
                if path[-1] == 'poses':
                    ci = path[1]
                    old_ids = [k['id'] for k in self.data['animations'][ci]['keyframes']]
                    clip_id = self.data['animations'][ci]['id']
                    clip = next(c for c in value['animations'] if c['id'] == clip_id)
                    new_ids = [k['id'] for k in clip['keyframes']]
                if old_ids != new_ids and len(old_ids) == len(old) and all(old_ids) and all(new_ids):
                    if not set(old_ids) <= set(new_ids):
                        raise ValueError(f'Animation deletion requires source editing and reimport: {path}')
                    indent, _ = self.blocks[path]
                    chunks = []
                    for key, item in zip(new_ids, new):
                        if key in old_ids:
                            index = old_ids.index(key)
                            begin, end = self.items[path+(index,)]
                            fragment = self.text[begin:end]
                            fragment = ''.join(line[indent:] if line.strip() else line for line in fragment.splitlines(keepends=True))
                            patched = Document(fragment).update([item])
                            chunks.append(''.join(' '*indent+line if line.strip() else line for line in patched.splitlines(keepends=True)))
                        else:
                            chunks.append(' '*indent + '- ' + flow(item) + newline)
                    begin = self.items[path+(0,)][0]
                    end = self.items[path+(len(old)-1,)][1]
                    edits.append((begin, end, ''.join(chunks)))
                    return
            if isinstance(old, dict) and isinstance(new, dict) and set(old) <= set(new):
                for key in old:
                    walk(old[key], new[key], path+(key,))
                added = {k: v for k, v in new.items() if k not in old}
                if added:
                    if path in self.blocks:
                        indent, end = self.blocks[path]
                        prefix = '' if end == 0 or self.text[end-1] == '\n' else newline
                        addition = prefix + ''.join(' '*indent + flow(k) + ': ' + flow(v) + newline for k, v in added.items())
                        edits.append((end, end, addition))
                    else:
                        # Replace only this flow map; discard overlapping child patches.
                        begin, end = self.spans[path]
                        edits[:] = [e for e in edits if not (begin <= e[0] < end)]
                        edits.append((begin, end, (' ' if begin == end else '') + flow(new)))
                return
            if isinstance(old, list) and isinstance(new, list) and len(new) >= len(old):
                for index, item in enumerate(old):
                    if isinstance(item, dict) and 'id' in item and item['id'] != new[index].get('id'):
                        raise ValueError(f'Element reorder requires explicit migration: {path}')
                    walk(item, new[index], path+(index,))
                if len(new) > len(old):
                    if path in self.blocks:
                        indent, end = self.blocks[path]
                        prefix = '' if end == 0 or self.text[end-1] == '\n' else newline
                        edits.append((end, end, prefix + ''.join(' '*indent+'- '+flow(v)+newline for v in new[len(old):])))
                    else:
                        begin, end = self.spans[path]
                        edits[:] = [e for e in edits if not (begin <= e[0] < end)]
                        edits.append((begin, end, flow(new)))
                return
            if path not in self.spans:
                raise ValueError(f'Structural change requires explicit migration: {path}')
            begin, end = self.spans[path]
            edits.append((begin, end, flow(new)))

        walk(self.data, value, ())
        text = self.text
        for begin, end, replacement in sorted(edits, reverse=True):
            text = text[:begin] + replacement + text[end:]
        if Document(text).data != value:
            raise ValueError('Source-preserving write failed validation')
        return text


def merge(base, disk, edited, path=()):
    """Three-way semantic merge. Conflicting changes abort before any write."""
    if edited == base or disk == edited:
        return copy.deepcopy(disk)
    if disk == base:
        return copy.deepcopy(edited)
    if all(isinstance(v, dict) for v in (base, disk, edited)):
        result = {}
        absent = object()
        for key in dict.fromkeys([*disk, *edited]):
            b, d, e = (v.get(key, absent) for v in (base, disk, edited))
            if e == b:
                if d is not absent:
                    result[key] = copy.deepcopy(d)
            elif d == b or d == e:
                if e is not absent:
                    result[key] = copy.deepcopy(e)
            elif any(v is absent for v in (b, d, e)):
                raise ValueError(f'Concurrent change: {path+(key,)}')
            else:
                result[key] = merge(b, d, e, path+(key,))
        return result
    if all(isinstance(v, list) for v in (base, disk, edited)):
        if all(all(isinstance(x, dict) and 'id' in x for x in v) for v in (base, disk, edited)):
            maps = [{x['id']: x for x in v} for v in (base, disk, edited)]
            if any(len(m) != len(v) for m, v in zip(maps, (base, disk, edited))):
                raise ValueError(f'Duplicate ID: {path}')
            return list(merge(*maps, path).values())
        if len(base) == len(disk) == len(edited):
            return [merge(b, d, e, path+(i,)) for i, (b, d, e) in enumerate(zip(base, disk, edited))]
    raise ValueError(f'Concurrent change: {path}; disk={disk!r}; Blender={edited!r}')


def read_text(filepath):
    """Decode gzip first, then UTF-8, preserving comments and newline characters."""
    data = Path(filepath).read_bytes()
    if str(filepath).lower().endswith('.gz'):
        data = gzip.decompress(data)
    return data.decode('utf-8')


def save_text(filepath, text, expected_bytes=None):
    """Write with a backup and same-directory atomic replacement."""
    path = Path(filepath)
    current = path.read_bytes() if path.exists() else None
    if expected_bytes is not None and current != expected_bytes:
        raise ValueError('Source changed during export; reload and merge again')
    payload = text.encode('utf-8')
    if str(path).lower().endswith('.gz'):
        payload = gzip.compress(payload, mtime=0)
    fd, tmp = tempfile.mkstemp(prefix='.webg-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        if current is not None:
            if path.read_bytes() != current:
                raise ValueError('Source changed during export')
            backup = path.with_name(path.name + f'.{time.time_ns()}.bak')
            backup.write_bytes(current)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def digest(text):
    """Hash UTF-8 source bytes independently of gzip headers and timestamps."""
    return hashlib.sha256(text.encode('utf-8')).hexdigest()
