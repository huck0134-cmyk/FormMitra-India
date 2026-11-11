(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const workspace = $("workspace");
  const imageInput = $("imageInput");
  let activeTool = "resize";
  let selectedImages = [];
  let originalImage = null;
  let resultBlob = null;
  let resultUrl = null;
  let aspectRatio = 1;

  $("year").textContent = new Date().getFullYear();

  $("themeToggle").addEventListener("click", () => {
    document.body.classList.toggle("dark");
    $("themeToggle").textContent = document.body.classList.contains("dark") ? "☀" : "☾";
  });

  document.querySelectorAll("[data-open]").forEach(button => {
    button.addEventListener("click", () => openTool(button.dataset.open));
  });

  function openTool(tool) {
    activeTool = tool;
    workspace.hidden = false;
    workspace.scrollIntoView({behavior:"smooth", block:"start"});
    $("resizeSettings").hidden = tool !== "resize";
    $("compressSettings").hidden = tool !== "compress";
    $("pdfSettings").hidden = tool !== "pdf";
    const labels = {
      resize:["Photo Resize","Resize photo or signature to your required dimensions."],
      compress:["Image Compressor","Reduce file size or aim for a target KB size."],
      pdf:["Image to PDF","Turn selected image(s) into a PDF document."]
    };
    $("workspaceTitle").textContent = labels[tool][0];
    $("workspaceDescription").textContent = labels[tool][1];
    resetResult();
    $("toolMessage").textContent = "";
    imageInput.multiple = tool === "pdf";
    imageInput.value = "";
    selectedImages = [];
    originalImage = null;
    $("fileNote").textContent = "No file selected";
    $("previewSection").hidden = true;
  }
  $("closeWorkspace").addEventListener("click", () => {workspace.hidden = true;});

  imageInput.addEventListener("change", () => handleFiles(imageInput.files));
  const dropArea = $("dropArea");
  ["dragenter","dragover"].forEach(type => dropArea.addEventListener(type, e => {e.preventDefault();dropArea.classList.add("dragging");}));
  ["dragleave","drop"].forEach(type => dropArea.addEventListener(type, e => {e.preventDefault();dropArea.classList.remove("dragging");}));
  dropArea.addEventListener("drop", e => handleFiles(e.dataTransfer.files));

  function handleFiles(fileList) {
    const files = Array.from(fileList || []).filter(f => f.type.startsWith("image/"));
    if (!files.length) { showMessage("Please choose a valid image file.", true); return; }
    if (activeTool !== "pdf" && files.length > 1) files.splice(1);
    selectedImages = files;
    $("fileNote").textContent = files.map(f => `${f.name} (${formatBytes(f.size)})`).join(" · ");
    const file = files[0];
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        originalImage = img;
        aspectRatio = img.width / img.height;
        $("widthInput").value = img.width;
        $("heightInput").value = img.height;
        $("originalPreview").src = reader.result;
        $("originalInfo").textContent = `${img.width} × ${img.height}px · ${formatBytes(file.size)}`;
        $("previewSection").hidden = false;
        $("resultPreview").removeAttribute("src");
        $("resultInfo").textContent = "Your output will appear here.";
        $("downloadBtn").hidden = true;
        resetResult();
        showMessage("Image loaded successfully.");
      };
      img.onerror = () => showMessage("Image could not be opened. Try another file.", true);
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  $("widthInput").addEventListener("input", () => {
    if ($("keepRatio").checked && originalImage) {
      const width = Number($("widthInput").value);
      if (width > 0) $("heightInput").value = Math.round(width / aspectRatio);
    }
  });
  $("heightInput").addEventListener("input", () => {
    if ($("keepRatio").checked && originalImage) {
      const height = Number($("heightInput").value);
      if (height > 0) $("widthInput").value = Math.round(height * aspectRatio);
    }
  });
  $("qualityInput").addEventListener("input", () => $("qualityLabel").textContent = `${$("qualityInput").value}%`);

  $("resizeBtn").addEventListener("click", async () => {
    if (!originalImage) return showMessage("Please select an image first.", true);
    const w = Number($("widthInput").value), h = Number($("heightInput").value);
    if (!validDimensions(w,h)) return showMessage("Width and height must be between 1 and 10000 pixels.", true);
    const canvas = document.createElement("canvas"); canvas.width=w; canvas.height=h;
    const ctx = canvas.getContext("2d"); ctx.drawImage(originalImage,0,0,w,h);
    const mime = selectedImages[0].type === "image/png" ? "image/png" : "image/jpeg";
    canvasBlob(canvas,mime,0.92).then(blob => setResult(blob, `Resized: ${w} × ${h}px`));
  });

  $("compressBtn").addEventListener("click", async () => {
    if (!originalImage) return showMessage("Please select an image first.", true);
    const mime = $("compressFormat").value;
    const quality = Number($("qualityInput").value)/100;
    const targetKB = Number($("targetKb").value);
    const canvas = document.createElement("canvas"); canvas.width=originalImage.width; canvas.height=originalImage.height;
    canvas.getContext("2d").drawImage(originalImage,0,0);
    let blob = await canvasBlob(canvas,mime,quality);
    if (targetKB > 0 && mime !== "image/png") {
      let q = quality;
      for (let i=0; i<8 && blob.size > targetKB*1024 && q > 0.08; i++) {
        q = Math.max(0.08,q-0.1);
        blob = await canvasBlob(canvas,mime,q);
      }
    }
    setResult(blob, `Compressed · ${formatBytes(blob.size)}${targetKB>0 ? ` (target: ${targetKB} KB)` : ""}`);
    if (targetKB>0 && blob.size>targetKB*1024) showMessage("Output is still above the requested target. Try smaller dimensions or lower quality.", true);
  });

  $("makePdfBtn").addEventListener("click", async () => {
    if (!selectedImages.length) return showMessage("Please select image(s) first.", true);
    if (!window.jspdf || !window.jspdf.jsPDF) return showMessage("PDF library could not load. Check internet connection and refresh.", true);
    try {
      const orientation = $("pdfOrientation").value;
      const size = $("pdfPageSize").value;
      const {jsPDF} = window.jspdf;
      const pdf = new jsPDF({orientation, unit:"mm", format:size==="fit" ? "a4" : size});
      for (let i=0; i<selectedImages.length; i++) {
        const data = await readAsDataURL(selectedImages[i]);
        const img = await loadImage(data);
        if (i>0) pdf.addPage();
        let pageW, pageH;
        if (size==="fit") {
          pageW = img.width * 0.264583; pageH = img.height * 0.264583;
          pdf.deletePage(1); // first page gets recreated to image dimensions
          if (i===0) {
            const custom = new jsPDF({orientation: img.width>=img.height?"landscape":"portrait",unit:"mm",format:[pageW,pageH]});
            custom.addImage(data, "JPEG", 0,0,pageW,pageH);
            for(let j=1;j<selectedImages.length;j++){
              const d=await readAsDataURL(selectedImages[j]); const im=await loadImage(d);
              custom.addPage([im.width*0.264583,im.height*0.264583],im.width>=im.height?"landscape":"portrait");
              custom.addImage(d,"JPEG",0,0,im.width*0.264583,im.height*0.264583);
            }
            custom.save("formmitra-images.pdf"); showMessage("PDF downloaded successfully."); return;
          }
        } else {
          const pageW=pdf.internal.pageSize.getWidth(), pageH=pdf.internal.pageSize.getHeight();
          const margin=8, scale=Math.min((pageW-margin*2)/img.width,(pageH-margin*2)/img.height);
          const w=img.width*scale,h=img.height*scale;
          pdf.addImage(data, "JPEG", (pageW-w)/2,(pageH-h)/2,w,h);
        }
      }
      pdf.save("formmitra-images.pdf"); showMessage("PDF downloaded successfully.");
    } catch (err) { console.error(err); showMessage("Could not create PDF. Try a smaller image or another format.", true); }
  });

  function validDimensions(w,h){return Number.isInteger(w)&&Number.isInteger(h)&&w>=1&&h>=1&&w<=10000&&h<=10000;}
  function canvasBlob(canvas,mime,quality){return new Promise(resolve=>canvas.toBlob(blob=>resolve(blob),mime,quality));}
  function setResult(blob,description){
    if(!blob)return showMessage("Could not process this image.",true);
    resultBlob=blob; resetResult(false);
    resultUrl=URL.createObjectURL(blob);
    $("resultPreview").src=resultUrl;
    $("resultInfo").textContent=`${description} · ${formatBytes(blob.size)}`;
    $("downloadBtn").href=resultUrl;
    $("downloadBtn").download=`formmitra-${activeTool}.${extensionFor(blob.type)}`;
    $("downloadBtn").hidden=false;
    $("previewSection").hidden=false;
    showMessage("Done! Your result is ready to download.");
  }
  function resetResult(revoke=true){
    if(revoke && resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl=null;resultBlob=null;
  }
  function extensionFor(type){return type==="image/png"?"png":type==="image/webp"?"webp":"jpg";}
  function formatBytes(bytes){if(bytes<1024)return `${bytes} B`;return `${(bytes/1024).toFixed(1)} KB`;}
  function showMessage(msg,error=false){$("toolMessage").textContent=msg;$("toolMessage").style.color=error?"#b42318":"#176b3a";}
  function readAsDataURL(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});}
  function loadImage(src){return new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=src;});}
})();