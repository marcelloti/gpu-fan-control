# gpu-fan-control

<span style="display:block;text-align:center">
    <img width='500' src='https://raw.githubusercontent.com/marcelloti/gpu-fan-control/main/screenshot.png'/>
</span>

<p>Control your GPU fans speed and see statics about your card</p>
<br/>
<p>The current version of the project only supports NVIDIA gpu cards.</p>
<p>The app was tested with NVIDIA GTX 560 and NVIDIA GTX 1050 Ti, using the packages <b>nvidia-driver and nvidia-legacy-390xx-driver</b> in Debian bullseye/sid.</p>
<p>With your collaboration this project will can support others video cards! Send your PR :)</p>
<br/>
<p><b>Dependencies:</b></p>
<p> - sudo</p>
<p> - nvidia-settings</p>
<br/>
<p><b>Pre-configuration</b></p>
<p>## (with nvidia-driver or nvidia-legacy-390xx-driver)</p>
<p>nvidia-xconfig --enable-all-gpus</p>
<p>nvidia-xconfig --cool-bits=4</p>
<p>(reboot your PC)</p>
<br/>
<p><b>Running from sources</b></p>
<p>git clone https://github.com/marcelloti/gpu-fan-control
<p>cd gpu-fan-control</p>
<p>npm install</p>
<p>nvidia-settings -a '[gpu:0]/GPUFanControlState=1'</p>
<p>sudo sysctl kernel.unprivileged_userns_clone=1</p>
<p>npm run electron-serve</p>
<br/>
<p><b>Running from binary files</b></p>
<p>nvidia-settings -a '[gpu:0]/GPUFanControlState=1'</p>
<p>sudo sysctl kernel.unprivileged_userns_clone=1</p>
<p>cd gpu-fan-control</p>
<p>./dist/gpu-fan-control-0.1.0.AppImage</p>