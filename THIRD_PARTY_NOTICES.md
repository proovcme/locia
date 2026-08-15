# Third-party notices

## buildingSMART Sample & Test Files

- Source: <https://github.com/buildingSMART/Sample-Test-Files>
- Pinned commit: `cecf656112a54a0d8cdd8b06b9398bfea5163886`
- License: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/)
- Included files: 23 IFC samples from IFC 4.0.2.1 and IFC 4.3.2.0 directories.
- Modification: person identifiers, person names and `FILE_NAME` author fields are cleared before publication. Geometry, object data and attribution are preserved.

The bundled JavaScript applications include third-party packages under their respective upstream licenses. Their package metadata and license notices remain part of the corresponding build artifacts.

## PDF editor and PyMuPDF

- Upstream application: <https://github.com/proovcme/pir_utilitys/pull/2>
- Pinned commit: `9470cce726a2cdbcad1be3efaec12e16c94bff37`
- PDF engine: [PyMuPDF](https://pymupdf.readthedocs.io/)
- License for `apps/pdf-editor/`: GNU Affero General Public License v3.0 or later

The web adapter, server boundary and included PDF engine source are available in this repository. The license of this module overrides the repository-level license only for files under `apps/pdf-editor/`.
