Summary: Simple STOMP messages broker
Name: %{name}
Version: %{version}
Release: 1
URL: http://www.teligent.ru
Vendor: Teligent OOO
License: Commercial
Group: Applications/System
BuildRoot: %{abs_top_builddir}/rpm/BUILD
Requires: nodejs
Prefix: /opt
BuildArch: noarch

%define __jar_repack 0
%description
Simple STOMP messages broker (aka STOMP server) in node.js
%{?desc}

%prep

%build

%install
rm -rf $RPM_BUILD_ROOT%{prefix}/%{name}
cd %{abs_top_builddir}/
rsync -a --exclude ".git" --exclude ".gitignore" --exclude "blackcatmq.service" %{abs_top_builddir}/ $RPM_BUILD_ROOT%{prefix}/%{name}
cp -a  $RPM_BUILD_ROOT %{abs_top_builddir}/blackcatmq.service $RPM_BUILD_ROOT/usr/lib/systemd/system

%pre

%post


%preun

%postun

%clean
rm -rf $RPM_BUILD_ROOT

%files
%defattr(-,root,root)
%{prefix}/*
/usr/lib/systemd/system/blackcatmq.service
