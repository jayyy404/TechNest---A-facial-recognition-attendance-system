# Facial-Recognition-System
This the main repository for the Capstone Project of IT - [ASU].


## Installation Instructions

1. Clone this repository (or download this as a zip file) and copy its contents to `C:\xampp\htdocs` (or whatever you placed your xampp installation in).
> Note that the contents must be copied, not the folder itself!
2. Open a terminal, go to the htdocs folder (`cd C:\xampp\htdocs`) and execute the command `npm install`.
> Ensure that you have installed [Node.js](https://nodejs.org/) before doing this, as the command will not work otherwise.
3. Execute `npm run build` in your terminal.
4. Open another terminal, go to the htdocs folder, and execute `py Original_code/scripts/server.py` (Make sure that you have python installed)
> If an error is thrown, saying something like `cv2 could not be resolved`, Make sure that the dependencies are installed. Try executing `pip install -r requirements.txt` first. Make sure that you are still in the htdocs directory while doing so. Then try the command again.
1. Open a browser and type [localhost](http://localhost) in the search bar.

## Serverless recognition (PHP -> Python CLI)

This repository now includes a "serverless" mode where the frontend calls a PHP endpoint which invokes a local Python CLI for facial recognition. This removes the need to run the Flask server manually.

How it works:
- The camera capture in the browser sends an image POST to `/api/recognize`.
- `src/api/recognize.php` saves the uploaded image and runs the Python CLI `Original_code/scripts/recognize_cli.py`.
- The Python CLI loads models, bootstraps user embeddings (by querying `/api/get-state`) and returns recognition results as JSON.

Notes and requirements:
- Python and the project's Python dependencies (see `requirements.txt`) must be installed on the machine where PHP runs.
- Ensure `python` is available in PATH for PHP's `shell_exec()` call; adjust `src/api/recognize.php` if you need to use a specific Python executable path.
- The first run may be slow because machine learning models are loaded and user embeddings are computed.

If you prefer the old Flask server approach, you can still run `Original_code/scripts/server.py` as before.